package app.marktextplus.android;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Log;
import android.webkit.MimeTypeMap;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.SyncFailedException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Virtual POSIX path layer used by {@link MtFsPlugin} and {@link VaultRequestHandler}.
 *
 * <ul>
 *   <li>{@code /data/marktext[/rel]} - app-private {@code filesDir/rel}.</li>
 *   <li>{@code /vault/<key>/<treeName>[/rel]} - a SAF tree granted via ACTION_OPEN_DOCUMENT_TREE.</li>
 *   <li>{@code /doc/<key>/<name>} - a single SAF document granted via ACTION_OPEN/CREATE_DOCUMENT.</li>
 * </ul>
 *
 * Grants live in the {@code mtfs_grants} SharedPreferences ({@code tree:<key>} / {@code doc:<key>}
 * entries holding {@code {uri,name}}). Everything else is PERMISSION_DENIED.
 */
public final class MtFsPaths {

    private static final String TAG = "MtFs";

    public static final String ENOENT = "ENOENT";
    public static final String EEXIST = "EEXIST";
    public static final String ENOTDIR = "ENOTDIR";
    public static final String EISDIR = "EISDIR";
    public static final String ENOTEMPTY = "ENOTEMPTY";
    public static final String PERMISSION_DENIED = "PERMISSION_DENIED";
    public static final String UNSUPPORTED_ON_ANDROID = "UNSUPPORTED_ON_ANDROID";
    public static final String EIO = "EIO";

    private static final String PREFS = "mtfs_grants";
    private static final String TREE_PREFIX = "tree:";
    private static final String DOC_PREFIX = "doc:";
    private static final String OCTET_STREAM = "application/octet-stream";

    private static final String[] DOC_PROJECTION = {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
        Document.COLUMN_FLAGS
    };

    /** Process-wide virtualPath -> documentId cache for granted trees, LRU bounded. */
    private static final int DOC_ID_CACHE_MAX = 512;
    private static final Map<String, String> docIdCache = new LinkedHashMap<String, String>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > DOC_ID_CACHE_MAX;
        }
    };

    private static final SecureRandom random = new SecureRandom();
    private static volatile MtFsPaths instance;

    private final Context context;
    private final ContentResolver resolver;
    private final SharedPreferences prefs;

    private MtFsPaths(Context context) {
        this.context = context.getApplicationContext();
        this.resolver = this.context.getContentResolver();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static MtFsPaths get(Context context) {
        MtFsPaths local = instance;
        if (local == null) {
            synchronized (MtFsPaths.class) {
                local = instance;
                if (local == null) {
                    local = new MtFsPaths(context);
                    instance = local;
                }
            }
        }
        return local;
    }

    /**
     * App-private file for {@code /data/marktext/<rel>}. {@code rel} is relative and slash separated;
     * empty or null means filesDir itself. Throws IllegalArgumentException on unsafe segments.
     */
    public static File privateFile(Context ctx, String rel) {
        File file = ctx.getFilesDir();
        if (rel == null) {
            return file;
        }
        if (rel.indexOf('\\') >= 0 || rel.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("Invalid path: " + rel);
        }
        for (String seg : rel.split("/")) {
            if (seg.isEmpty()) {
                continue;
            }
            if (seg.equals(".") || seg.equals("..")) {
                throw new IllegalArgumentException("Invalid path: " + rel);
            }
            file = new File(file, seg);
        }
        return file;
    }

    /** Starts a unit of work (one plugin call / one request) with its own children-query cache. */
    public Op begin() {
        return new Op();
    }

    // ---------------------------------------------------------------------------------------------
    // Errors and value types

    /** An error carrying one of the contract codes; the message includes the virtual path. */
    public static final class FsException extends Exception {

        public final String code;

        FsException(String code, String message) {
            super(message);
            this.code = code;
        }

        FsException(String code, String message, Throwable cause) {
            super(message, cause);
            this.code = code;
        }
    }

    private static FsException fsError(String code, String vpath) {
        return new FsException(code, code + ": " + vpath);
    }

    private static FsException fsError(String code, String vpath, String detail) {
        return new FsException(code, code + ": " + detail + ", '" + vpath + "'");
    }

    /** stat() result. birthtimeMs equals mtimeMs for SAF documents. */
    public static final class Info {

        public final String name;
        public final boolean isDirectory;
        public final long size;
        public final long mtimeMs;
        public final long birthtimeMs;

        Info(String name, boolean isDirectory, long size, long mtimeMs, long birthtimeMs) {
            this.name = name;
            this.isDirectory = isDirectory;
            this.size = isDirectory ? 0 : size;
            this.mtimeMs = mtimeMs;
            this.birthtimeMs = birthtimeMs;
        }

        static Info of(Row row, String name) {
            return new Info(name, row.isDir(), row.size, row.mtime, row.mtime);
        }
    }

    /** Persisted grant: the SAF uri plus the name used as path segment. */
    public static final class Grant {

        public final String key;
        public final Uri uri;
        public final String name;

        Grant(String key, Uri uri, String name) {
            this.key = key;
            this.uri = uri;
            this.name = name;
        }
    }

    /** Result of a picker: the virtual path and the display name. */
    public static final class Picked {

        public final String path;
        public final String name;

        Picked(String path, String name) {
            this.path = path;
            this.name = name;
        }
    }

    /** Streams content into a destination; must be replayable (may be invoked more than once). */
    public interface Payload {
        void writeTo(OutputStream out) throws IOException;
    }

    /** One SAF row from DOC_PROJECTION. */
    static final class Row {

        final String docId;
        final String name;
        final String mime;
        final long size;
        final long mtime;
        final int flags;

        Row(Cursor c) {
            docId = c.getString(0);
            name = c.isNull(1) ? "" : c.getString(1);
            mime = c.isNull(2) ? "" : c.getString(2);
            size = c.isNull(3) ? 0 : c.getLong(3);
            mtime = c.isNull(4) ? 0 : c.getLong(4);
            flags = c.isNull(5) ? 0 : c.getInt(5);
        }

        boolean isDir() {
            return Document.MIME_TYPE_DIR.equals(mime);
        }

        boolean supports(int flag) {
            return (flags & flag) != 0;
        }
    }

    private enum Kind {
        /** filesDir based. */
        PRIVATE,
        /** Inside (or the root of) a granted tree. */
        TREE,
        /** A granted single document. */
        DOC,
        /** {@code /vault/<key>} or {@code /doc/<key>}: synthetic dir listing the grant's name. */
        GRANT_DIR
    }

    /** A parsed and permission-checked virtual path. */
    private static final class Loc {

        final Kind kind;
        final String vpath;
        final List<String> rel;
        final File file;
        final Grant grant;
        final boolean treeGrant;

        Loc(Kind kind, String vpath, List<String> rel, File file, Grant grant, boolean treeGrant) {
            this.kind = kind;
            this.vpath = vpath;
            this.rel = rel;
            this.file = file;
            this.grant = grant;
            this.treeGrant = treeGrant;
        }

        /** Roots are the grant boundaries and filesDir itself; they can't be removed or replaced. */
        boolean isRoot() {
            switch (kind) {
                case PRIVATE:
                case TREE:
                    return rel.isEmpty();
                default:
                    return true;
            }
        }

        String name() {
            if (kind == Kind.DOC) {
                return grant.name;
            }
            return rel.isEmpty() ? "" : rel.get(rel.size() - 1);
        }

        Loc parent() {
            List<String> up = rel.subList(0, rel.size() - 1);
            String parentPath = vpath.substring(0, vpath.lastIndexOf('/'));
            return new Loc(kind, parentPath, up, kind == Kind.PRIVATE ? file.getParentFile() : null, grant, treeGrant);
        }

        Loc child(String name) {
            List<String> down = new ArrayList<>(rel);
            down.add(name);
            return new Loc(kind, vpath + "/" + name, down, kind == Kind.PRIVATE ? new File(file, name) : null, grant, treeGrant);
        }

        /** Virtual path of the first {@code depth} rel segments (TREE only). */
        String prefixPath(int depth) {
            StringBuilder sb = new StringBuilder("/vault/").append(grant.key).append('/').append(grant.name);
            for (int i = 0; i < depth; i++) {
                sb.append('/').append(rel.get(i));
            }
            return sb.toString();
        }
    }

    /** Deepest existing point reached while walking a tree path. */
    private static final class Walk {

        /** Number of rel segments resolved; equals rel.size() when the target exists. */
        int depth;
        String docId;
        /** Row of docId; null for the tree root (always a directory). */
        Row row;
        /** The walk stopped because a non-directory sits at {@code depth}. */
        boolean blockedByFile;

        boolean exists(Loc loc) {
            return depth == loc.rel.size() && !blockedByFile;
        }

        boolean isDir() {
            return row == null || row.isDir();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Grants

    static String keyFor(Uri uri) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(uri.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) {
                sb.append(String.format(Locale.ROOT, "%02x", digest[i] & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Display names become path segments: no separators, NUL or dot-segments. */
    static String sanitizeName(String name, String fallback) {
        if (name == null || name.isEmpty()) {
            return fallback;
        }
        String safe = name.replace('/', '_').replace('\\', '_').replace('\0', '_');
        if (safe.equals(".") || safe.equals("..")) {
            return safe.replace('.', '_');
        }
        return safe;
    }

    private Grant loadGrant(String prefix, String key) {
        String json = prefs.getString(prefix + key, null);
        if (json == null) {
            return null;
        }
        try {
            JSONObject obj = new JSONObject(json);
            return new Grant(key, Uri.parse(obj.getString("uri")), obj.getString("name"));
        } catch (JSONException e) {
            Log.w(TAG, "Corrupt grant entry " + prefix + key, e);
            return null;
        }
    }

    private void storeGrant(String prefix, Grant grant) {
        JSONObject obj = new JSONObject();
        try {
            obj.put("uri", grant.uri.toString());
            obj.put("name", grant.name);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        prefs.edit().putString(prefix + grant.key, obj.toString()).apply();
    }

    private List<Grant> treeGrants() {
        List<Grant> out = new ArrayList<>();
        for (String k : prefs.getAll().keySet()) {
            if (k.startsWith(TREE_PREFIX)) {
                Grant g = loadGrant(TREE_PREFIX, k.substring(TREE_PREFIX.length()));
                if (g != null) {
                    out.add(g);
                }
            }
        }
        return out;
    }

    private boolean isPersisted(Uri uri) {
        for (UriPermission p : resolver.getPersistedUriPermissions()) {
            if (p.getUri().equals(uri)) {
                return true;
            }
        }
        return false;
    }

    /** Takes READ|WRITE persistable permission; single documents fall back to READ when write is not grantable. */
    private void persist(Uri uri, boolean allowReadOnly) {
        int rw = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        try {
            resolver.takePersistableUriPermission(uri, rw);
        } catch (SecurityException e) {
            if (!allowReadOnly) {
                throw e;
            }
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
    }

    /** Persists a picked tree and returns its {@code /vault/<key>/<treeName>} location. */
    public Picked grantTree(Uri treeUri) {
        persist(treeUri, false);
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        Row root = queryRow(DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId));
        String name = sanitizeName(root != null ? root.name : null, "vault");
        Grant grant = new Grant(keyFor(treeUri), treeUri, name);
        storeGrant(TREE_PREFIX, grant);
        clearTreeCache(grant.key);
        return new Picked("/vault/" + grant.key + "/" + grant.name, grant.name);
    }

    /**
     * Persists a picked single document. Returns the {@code /vault/...} path when the document lies
     * inside a granted tree (API 26+), else {@code /doc/<key>/<name>}.
     */
    public Picked grantDocument(Uri docUri) {
        persist(docUri, true);
        Row row = queryRow(docUri);
        String name = sanitizeName(row != null ? row.name : null, "document");
        Grant grant = new Grant(keyFor(docUri), docUri, name);
        storeGrant(DOC_PREFIX, grant);
        Picked inTree = findInGrantedTree(docUri);
        return inTree != null ? inTree : new Picked("/doc/" + grant.key + "/" + grant.name, grant.name);
    }

    private Picked findInGrantedTree(Uri docUri) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !DocumentsContract.isDocumentUri(context, docUri)) {
            return null;
        }
        String docId = DocumentsContract.getDocumentId(docUri);
        for (Grant tree : treeGrants()) {
            if (!String.valueOf(tree.uri.getAuthority()).equals(docUri.getAuthority()) || !isPersisted(tree.uri)) {
                continue;
            }
            try {
                Uri inTree = DocumentsContract.buildDocumentUriUsingTree(tree.uri, docId);
                DocumentsContract.Path found = DocumentsContract.findDocumentPath(resolver, inTree);
                if (found == null) {
                    continue;
                }
                List<String> ids = found.getPath();
                String rootId = DocumentsContract.getTreeDocumentId(tree.uri);
                if (ids.isEmpty() || !ids.get(0).equals(rootId) || ids.size() < 2) {
                    continue;
                }
                StringBuilder path = new StringBuilder("/vault/").append(tree.key).append('/').append(tree.name);
                String name = null;
                for (int i = 1; i < ids.size(); i++) {
                    Row r = queryRow(DocumentsContract.buildDocumentUriUsingTree(tree.uri, ids.get(i)));
                    if (r == null || r.name.isEmpty() || r.name.contains("/") || r.name.equals(".") || r.name.equals("..")) {
                        name = null;
                        break;
                    }
                    name = r.name;
                    path.append('/').append(name);
                    cachePut(path.toString(), ids.get(i));
                }
                if (name != null) {
                    return new Picked(path.toString(), name);
                }
            } catch (Exception e) {
                Log.d(TAG, "findDocumentPath failed for tree " + tree.key, e);
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------------------------------
    // Parsing

    private Loc parse(String path) throws FsException {
        if (path == null || !path.startsWith("/") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
            throw fsError(PERMISSION_DENIED, String.valueOf(path), "invalid path");
        }
        List<String> segs = new ArrayList<>();
        for (String seg : path.split("/")) {
            if (seg.isEmpty()) {
                continue;
            }
            if (seg.equals(".") || seg.equals("..")) {
                throw fsError(PERMISSION_DENIED, path, "dot segments are not allowed");
            }
            segs.add(seg);
        }
        StringBuilder norm = new StringBuilder();
        for (String seg : segs) {
            norm.append('/').append(seg);
        }
        String vpath = norm.toString();
        String root = segs.isEmpty() ? "" : segs.get(0);

        if (root.equals("data") && segs.size() >= 2 && segs.get(1).equals("marktext")) {
            List<String> rel = new ArrayList<>(segs.subList(2, segs.size()));
            File file = context.getFilesDir();
            for (String seg : rel) {
                file = new File(file, seg);
            }
            return new Loc(Kind.PRIVATE, vpath, rel, file, null, false);
        }
        boolean isTree = root.equals("vault");
        if ((isTree || root.equals("doc")) && segs.size() >= 2) {
            Grant grant = loadGrant(isTree ? TREE_PREFIX : DOC_PREFIX, segs.get(1));
            if (grant == null) {
                throw fsError(PERMISSION_DENIED, vpath, "no grant");
            }
            if (!isPersisted(grant.uri)) {
                throw fsError(PERMISSION_DENIED, vpath, "grant revoked");
            }
            if (segs.size() == 2) {
                return new Loc(Kind.GRANT_DIR, vpath, Collections.emptyList(), null, grant, isTree);
            }
            if (!segs.get(2).equals(grant.name)) {
                throw fsError(ENOENT, vpath, "no such file or directory");
            }
            if (isTree) {
                return new Loc(Kind.TREE, vpath, new ArrayList<>(segs.subList(3, segs.size())), null, grant, true);
            }
            if (segs.size() > 3) {
                throw fsError(ENOTDIR, vpath, "not a directory");
            }
            return new Loc(Kind.DOC, vpath, Collections.emptyList(), null, grant, false);
        }
        throw fsError(PERMISSION_DENIED, vpath, "outside of the allowed roots");
    }

    // ---------------------------------------------------------------------------------------------
    // Global documentId cache

    private static void cachePut(String vpath, String docId) {
        synchronized (docIdCache) {
            docIdCache.put(vpath, docId);
        }
    }

    private static String cacheGet(String vpath) {
        synchronized (docIdCache) {
            return docIdCache.get(vpath);
        }
    }

    private static void cacheRemove(String vpath) {
        synchronized (docIdCache) {
            docIdCache.remove(vpath);
        }
    }

    private static void clearTreeCache(String key) {
        String prefix = "/vault/" + key + "/";
        synchronized (docIdCache) {
            Iterator<String> it = docIdCache.keySet().iterator();
            while (it.hasNext()) {
                if (it.next().startsWith(prefix)) {
                    it.remove();
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Low-level SAF helpers

    /** Queries one document row; null when the document is missing. SecurityException propagates. */
    private Row queryRow(Uri uri) {
        try (Cursor c = resolver.query(uri, DOC_PROJECTION, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return new Row(c);
            }
            return null;
        } catch (SecurityException e) {
            throw e;
        } catch (RuntimeException e) {
            // Providers signal missing documents with IllegalArgumentException & co.
            Log.d(TAG, "query failed for " + uri, e);
            return null;
        }
    }

    private static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
            if (mime != null) {
                return mime;
            }
        }
        return OCTET_STREAM;
    }

    private static String randomSuffix() {
        return Long.toHexString(random.nextLong() & 0xffffffffffL);
    }

    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
    }

    private static void syncQuietly(FileOutputStream out) throws IOException {
        out.flush();
        try {
            out.getFD().sync();
        } catch (SyncFailedException e) {
            // Pipes/sockets handed out by remote providers can't be fsynced; nothing to do.
        }
    }

    /** Writes {@code payload} through a provider file descriptor opened with {@code mode}. */
    private void writeDocument(Uri uri, String mode, Payload payload) throws IOException {
        ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, mode);
        if (pfd == null) {
            throw new IOException("Provider returned no descriptor for " + uri);
        }
        try (FileOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pfd)) {
            payload.writeTo(out);
            syncQuietly(out);
        }
    }

    private Uri renameDoc(Uri uri, String name) throws IOException {
        Uri renamed = DocumentsContract.renameDocument(resolver, uri, name);
        if (renamed == null) {
            throw new IOException("Rename to '" + name + "' failed");
        }
        return renamed;
    }

    private void deleteDocQuietly(Uri uri) {
        try {
            DocumentsContract.deleteDocument(resolver, uri);
        } catch (Exception e) {
            Log.w(TAG, "Failed to delete " + uri, e);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Operations

    /**
     * A unit of work. Holds the per-call children cache (one query per directory); not thread-safe,
     * use one Op per call.
     */
    public final class Op {

        /** treeUri + '\n' + parentDocId -> children rows. */
        private final Map<String, List<Row>> children = new HashMap<>();

        private Op() {}

        // ----- tree resolution

        private Uri docUri(Loc loc, String docId) {
            return DocumentsContract.buildDocumentUriUsingTree(loc.grant.uri, docId);
        }

        private List<Row> listChildren(Loc loc, String parentId) {
            String cacheKey = loc.grant.uri + "\n" + parentId;
            List<Row> rows = children.get(cacheKey);
            if (rows != null) {
                return rows;
            }
            rows = new ArrayList<>();
            Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(loc.grant.uri, parentId);
            try (Cursor c = resolver.query(uri, DOC_PROJECTION, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    rows.add(new Row(c));
                }
            } catch (SecurityException e) {
                throw e;
            } catch (RuntimeException e) {
                Log.d(TAG, "children query failed for " + uri, e);
            }
            children.put(cacheKey, rows);
            return rows;
        }

        private void childrenChanged(Loc loc, String parentId) {
            children.remove(loc.grant.uri + "\n" + parentId);
            clearTreeCache(loc.grant.key);
        }

        private Walk walk(Loc loc) {
            List<String> rel = loc.rel;
            int n = rel.size();
            Walk w = new Walk();
            w.docId = DocumentsContract.getTreeDocumentId(loc.grant.uri);
            // Resume from the deepest cached ancestor that still checks out.
            for (int i = n; i >= 1; i--) {
                String key = loc.prefixPath(i);
                String cached = cacheGet(key);
                if (cached == null) {
                    continue;
                }
                Row r = queryRow(docUri(loc, cached));
                if (r != null && r.name.equals(rel.get(i - 1)) && (i == n || r.isDir())) {
                    w.depth = i;
                    w.docId = cached;
                    w.row = r;
                    break;
                }
                cacheRemove(key);
            }
            while (w.depth < n) {
                if (!w.isDir()) {
                    w.blockedByFile = true;
                    break;
                }
                Row child = null;
                String want = rel.get(w.depth);
                for (Row r : listChildren(loc, w.docId)) {
                    if (want.equals(r.name)) {
                        child = r;
                        break;
                    }
                }
                if (child == null) {
                    break;
                }
                w.depth++;
                w.docId = child.docId;
                w.row = child;
                cachePut(loc.prefixPath(w.depth), child.docId);
            }
            return w;
        }

        /** Existing tree target or ENOENT/ENOTDIR. */
        private Walk existing(Loc loc) throws FsException {
            Walk w = walk(loc);
            if (w.blockedByFile) {
                throw fsError(ENOTDIR, loc.vpath, "not a directory");
            }
            if (!w.exists(loc)) {
                throw fsError(ENOENT, loc.vpath, "no such file or directory");
            }
            return w;
        }

        /** Makes every directory of {@code dir} exist (TREE) and returns its documentId. */
        private String ensureTreeDirs(Loc dir) throws FsException, IOException {
            Walk w = walk(dir);
            if (w.blockedByFile || !w.isDir()) {
                throw fsError(ENOTDIR, dir.vpath, "not a directory");
            }
            String parentId = w.docId;
            for (int i = w.depth; i < dir.rel.size(); i++) {
                String name = dir.rel.get(i);
                Uri created = DocumentsContract.createDocument(resolver, docUri(dir, parentId), Document.MIME_TYPE_DIR, name);
                if (created == null) {
                    throw fsError(EIO, dir.vpath, "could not create directory");
                }
                childrenChanged(dir, parentId);
                parentId = DocumentsContract.getDocumentId(created);
            }
            return parentId;
        }

        // ----- private (filesDir) helpers

        private void ensurePrivateDirs(Loc dir) throws FsException {
            File cur = context.getFilesDir();
            for (String seg : dir.rel) {
                cur = new File(cur, seg);
                if (cur.isDirectory()) {
                    continue;
                }
                if (cur.exists()) {
                    throw fsError(ENOTDIR, dir.vpath, "not a directory");
                }
                if (!cur.mkdir() && !cur.isDirectory()) {
                    throw fsError(EIO, dir.vpath, "could not create directory");
                }
            }
        }

        private Info privateInfo(File f) {
            boolean dir = f.isDirectory();
            long mtime = f.lastModified();
            long birth = mtime;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    birth = Files.readAttributes(f.toPath(), BasicFileAttributes.class).creationTime().toMillis();
                } catch (IOException | RuntimeException e) {
                    birth = mtime;
                }
            }
            return new Info(f.getName(), dir, dir ? 0 : f.length(), mtime, birth);
        }

        private boolean deleteRecursive(File f) {
            File[] kids = f.isDirectory() ? f.listFiles() : null;
            if (kids != null) {
                for (File k : kids) {
                    if (!deleteRecursive(k)) {
                        return false;
                    }
                }
            }
            return f.delete() || !f.exists();
        }

        // ----- stat / readdir / read

        /** Returns null when the path does not exist (including a missing grant root name). */
        public Info stat(String path) throws FsException {
            try {
                return stat(parse(path));
            } catch (FsException e) {
                if (ENOENT.equals(e.code) || ENOTDIR.equals(e.code)) {
                    return null;
                }
                throw e;
            }
        }

        private Info stat(Loc loc) throws FsException {
            switch (loc.kind) {
                case PRIVATE:
                    return loc.file.exists() ? privateInfo(loc.file) : null;
                case GRANT_DIR:
                    return new Info(loc.grant.key, true, 0, 0, 0);
                case DOC: {
                    Row r = queryRow(loc.grant.uri);
                    return r == null ? null : Info.of(r, loc.grant.name);
                }
                case TREE:
                default: {
                    if (loc.rel.isEmpty()) {
                        Row r = queryRow(docUri(loc, DocumentsContract.getTreeDocumentId(loc.grant.uri)));
                        return r == null ? null : new Info(loc.grant.name, true, 0, r.mtime, r.mtime);
                    }
                    Walk w = walk(loc);
                    return w.exists(loc) ? Info.of(w.row, loc.name()) : null;
                }
            }
        }

        /** Directory entries sorted by name. */
        public List<Info> readdir(String path) throws FsException {
            Loc loc = parse(path);
            List<Info> out = new ArrayList<>();
            switch (loc.kind) {
                case PRIVATE: {
                    if (!loc.file.exists()) {
                        throw fsError(ENOENT, loc.vpath, "no such file or directory");
                    }
                    File[] files = loc.file.listFiles();
                    if (!loc.file.isDirectory() || files == null) {
                        throw fsError(ENOTDIR, loc.vpath, "not a directory");
                    }
                    for (File f : files) {
                        out.add(privateInfo(f));
                    }
                    break;
                }
                case GRANT_DIR: {
                    Loc child = loc.child(loc.grant.name);
                    Loc resolved = loc.treeGrant
                        ? new Loc(Kind.TREE, child.vpath, Collections.emptyList(), null, loc.grant, true)
                        : new Loc(Kind.DOC, child.vpath, Collections.emptyList(), null, loc.grant, false);
                    Info info = stat(resolved);
                    out.add(info != null ? info : new Info(loc.grant.name, loc.treeGrant, 0, 0, 0));
                    break;
                }
                case DOC:
                    throw fsError(ENOTDIR, loc.vpath, "not a directory");
                case TREE:
                default: {
                    Walk w = existing(loc);
                    if (!w.isDir()) {
                        throw fsError(ENOTDIR, loc.vpath, "not a directory");
                    }
                    for (Row r : listChildren(loc, w.docId)) {
                        out.add(Info.of(r, r.name));
                    }
                    break;
                }
            }
            Collections.sort(out, (a, b) -> a.name.compareTo(b.name));
            return out;
        }

        /** Opens a file for reading; ENOENT when missing, EISDIR for directories. */
        public InputStream openInput(String path) throws FsException, IOException {
            return openInput(parse(path));
        }

        private InputStream openInput(Loc loc) throws FsException, IOException {
            switch (loc.kind) {
                case PRIVATE:
                    if (loc.file.isDirectory()) {
                        throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                    }
                    if (!loc.file.exists()) {
                        throw fsError(ENOENT, loc.vpath, "no such file or directory");
                    }
                    return new FileInputStream(loc.file);
                case GRANT_DIR:
                    throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                case DOC:
                    return checkedStream(resolver.openInputStream(loc.grant.uri), loc);
                case TREE:
                default: {
                    if (loc.rel.isEmpty()) {
                        throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                    }
                    Walk w = existing(loc);
                    if (w.row.isDir()) {
                        throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                    }
                    return checkedStream(resolver.openInputStream(docUri(loc, w.docId)), loc);
                }
            }
        }

        private InputStream checkedStream(InputStream in, Loc loc) throws FsException {
            if (in == null) {
                throw fsError(EIO, loc.vpath, "provider returned no stream");
            }
            return in;
        }

        public byte[] readFile(String path) throws FsException, IOException {
            try (InputStream in = openInput(path)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                copyStream(in, out);
                return out.toByteArray();
            }
        }

        // ----- write

        public void writeFile(String path, Payload payload) throws FsException, IOException {
            write(parse(path), payload);
        }

        private void write(Loc loc, Payload payload) throws FsException, IOException {
            switch (loc.kind) {
                case GRANT_DIR:
                    throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                case DOC:
                    // Single-document grants: always truncate in place. Replacing the document
                    // (temp + rename) would mint a new document and invalidate the persisted grant.
                    writeDocument(loc.grant.uri, "wt", payload);
                    return;
                case PRIVATE:
                    writePrivate(loc, payload);
                    return;
                case TREE:
                default:
                    writeTree(loc, payload);
            }
        }

        private void writePrivate(Loc loc, Payload payload) throws FsException, IOException {
            if (loc.rel.isEmpty() || loc.file.isDirectory()) {
                throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
            }
            ensurePrivateDirs(loc.parent());
            File target = loc.file;
            File temp = new File(target.getParentFile(), "." + target.getName() + ".mt-tmp-" + randomSuffix());
            boolean done = false;
            try {
                try (FileOutputStream out = new FileOutputStream(temp)) {
                    payload.writeTo(out);
                    out.flush();
                    out.getFD().sync();
                }
                if (!temp.renameTo(target)) {
                    if (target.isDirectory()) {
                        throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                    }
                    if (!target.delete() || !temp.renameTo(target)) {
                        throw fsError(EIO, loc.vpath, "could not replace file");
                    }
                }
                done = true;
            } finally {
                if (!done && !temp.delete() && temp.exists()) {
                    Log.w(TAG, "Failed to remove temp file " + temp);
                }
            }
        }

        private void writeTree(Loc loc, Payload payload) throws FsException, IOException {
            if (loc.rel.isEmpty()) {
                throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
            }
            Walk w = walk(loc);
            if (w.blockedByFile) {
                throw fsError(ENOTDIR, loc.vpath, "not a directory");
            }
            String name = loc.name();
            try {
                if (!w.exists(loc)) {
                    String parentId = ensureTreeDirs(loc.parent());
                    Uri created = DocumentsContract.createDocument(resolver, docUri(loc, parentId), mimeFor(name), name);
                    if (created == null) {
                        throw fsError(EIO, loc.vpath, "could not create file");
                    }
                    childrenChanged(loc, parentId);
                    // Brand-new document: nothing to protect, write it directly.
                    writeDocument(created, "wt", payload);
                    return;
                }
                if (w.row.isDir()) {
                    throw fsError(EISDIR, loc.vpath, "illegal operation on a directory");
                }
                Uri target = docUri(loc, w.docId);
                if (!w.row.supports(Document.FLAG_SUPPORTS_RENAME)) {
                    // The provider can't rename, so it can't replace atomically; "wt" at least
                    // truncates (plain "w" leaves stale trailing bytes on some providers).
                    writeDocument(target, "wt", payload);
                    return;
                }
                String parentId = loc.rel.size() == 1
                    ? DocumentsContract.getTreeDocumentId(loc.grant.uri)
                    : existing(loc.parent()).docId;
                replaceViaRename(loc, docUri(loc, parentId), target, payload);
                childrenChanged(loc, parentId);
            } finally {
                clearTreeCache(loc.grant.key);
            }
        }

        /** temp sibling -> target renamed to backup -> temp renamed to target -> backup deleted. */
        private void replaceViaRename(Loc loc, Uri parent, Uri target, Payload payload) throws FsException, IOException {
            String name = loc.name();
            String rand = randomSuffix();
            Uri temp = DocumentsContract.createDocument(resolver, parent, mimeFor(name), "." + name + ".mt-tmp-" + rand);
            if (temp == null) {
                throw fsError(EIO, loc.vpath, "could not create temp file");
            }
            boolean tempPending = true;
            try {
                Row tempRow = queryRow(temp);
                if (tempRow == null || !tempRow.supports(Document.FLAG_SUPPORTS_RENAME)) {
                    // Rename unsupported for new documents: no atomic swap possible, truncate in place.
                    writeDocument(target, "wt", payload);
                    return;
                }
                writeDocument(temp, "w", payload);
                Uri backup = renameDoc(target, "." + name + ".mt-bak-" + rand);
                Uri finalUri;
                try {
                    finalUri = renameDoc(temp, name);
                } catch (IOException | RuntimeException e) {
                    restoreBackup(backup, name);
                    throw e;
                }
                tempPending = false;
                Row finalRow = queryRow(finalUri);
                if (finalRow == null || !name.equals(finalRow.name)) {
                    // The provider altered the name (e.g. "name (1)"): undo the swap and fall back to
                    // truncating the original document in place.
                    deleteDocQuietly(finalUri);
                    Uri restored = renameDoc(backup, name);
                    writeDocument(restored, "wt", payload);
                    return;
                }
                deleteDocQuietly(backup);
            } finally {
                if (tempPending) {
                    deleteDocQuietly(temp);
                }
            }
        }

        private void restoreBackup(Uri backup, String name) {
            try {
                renameDoc(backup, name);
            } catch (Exception e) {
                Log.e(TAG, "Failed to restore backup to '" + name + "': " + backup, e);
            }
        }

        // ----- mkdirp / remove / rename / copy

        public void mkdirp(String path) throws FsException, IOException {
            mkdirp(parse(path));
        }

        private void mkdirp(Loc loc) throws FsException, IOException {
            switch (loc.kind) {
                case PRIVATE:
                    ensurePrivateDirs(loc);
                    return;
                case GRANT_DIR:
                    return;
                case DOC:
                    throw fsError(ENOTDIR, loc.vpath, "not a directory");
                case TREE:
                default:
                    try {
                        ensureTreeDirs(loc);
                    } finally {
                        clearTreeCache(loc.grant.key);
                    }
            }
        }

        public void remove(String path) throws FsException, IOException {
            remove(parse(path));
        }

        private void remove(Loc loc) throws FsException, IOException {
            if (loc.isRoot()) {
                throw fsError(PERMISSION_DENIED, loc.vpath, "cannot remove a root");
            }
            if (loc.kind == Kind.PRIVATE) {
                if (!loc.file.exists()) {
                    throw fsError(ENOENT, loc.vpath, "no such file or directory");
                }
                if (!deleteRecursive(loc.file)) {
                    throw fsError(EIO, loc.vpath, "could not remove");
                }
                return;
            }
            Walk w = existing(loc);
            try {
                if (!DocumentsContract.deleteDocument(resolver, docUri(loc, w.docId))) {
                    throw fsError(EIO, loc.vpath, "could not remove");
                }
            } finally {
                children.clear();
                clearTreeCache(loc.grant.key);
            }
        }

        public void rename(String fromPath, String toPath) throws FsException, IOException {
            Loc from = parse(fromPath);
            Loc to = parse(toPath);
            Info src = stat(from);
            if (src == null) {
                throw fsError(ENOENT, from.vpath, "no such file or directory");
            }
            if (stat(to) != null) {
                throw fsError(EEXIST, to.vpath, "file already exists");
            }
            if (from.isRoot() || to.isRoot()) {
                throw fsError(PERMISSION_DENIED, from.isRoot() ? from.vpath : to.vpath, "cannot rename a root");
            }
            if (to.vpath.startsWith(from.vpath + "/")) {
                throw fsError(EIO, to.vpath, "cannot move a directory into itself");
            }
            if (from.kind == Kind.PRIVATE && to.kind == Kind.PRIVATE) {
                ensurePrivateDirs(to.parent());
                if (!from.file.renameTo(to.file)) {
                    throw fsError(EIO, from.vpath, "rename failed");
                }
                return;
            }
            if (from.kind == Kind.TREE && to.kind == Kind.TREE && from.grant.key.equals(to.grant.key)) {
                try {
                    renameInTree(from, to);
                } finally {
                    children.clear();
                    clearTreeCache(from.grant.key);
                }
                return;
            }
            copyRecursive(from, to, src);
            remove(from);
        }

        private void renameInTree(Loc from, Loc to) throws FsException, IOException {
            Walk src = existing(from);
            String srcParentId = existing(from.parent()).docId;
            String dstParentId = ensureTreeDirs(to.parent());
            Uri srcUri = docUri(from, src.docId);
            if (srcParentId.equals(dstParentId)) {
                renameDoc(srcUri, to.name());
                return;
            }
            if (src.row.supports(Document.FLAG_SUPPORTS_MOVE)) {
                Uri moved = DocumentsContract.moveDocument(resolver, srcUri, docUri(from, srcParentId), docUri(to, dstParentId));
                if (moved == null) {
                    throw fsError(EIO, from.vpath, "move failed");
                }
                if (!from.name().equals(to.name())) {
                    renameDoc(moved, to.name());
                }
                return;
            }
            copyRecursive(from, to, Info.of(src.row, from.name()));
            remove(from);
        }

        private void copyRecursive(Loc from, Loc to, Info src) throws FsException, IOException {
            if (!src.isDirectory) {
                write(to, streamOf(from));
                return;
            }
            mkdirp(to);
            for (Info entry : readdir(from.vpath)) {
                copyRecursive(from.child(entry.name), to.child(entry.name), entry);
            }
        }

        private Payload streamOf(Loc from) {
            return out -> {
                try (InputStream in = openInput(from)) {
                    copyStream(in, out);
                } catch (FsException e) {
                    throw new IOException(e.getMessage(), e);
                }
            };
        }

        /** File copy; creates parents of {@code to} and overwrites an existing file target. */
        public void copy(String fromPath, String toPath) throws FsException, IOException {
            Loc from = parse(fromPath);
            Loc to = parse(toPath);
            Info src = stat(from);
            if (src == null) {
                throw fsError(ENOENT, from.vpath, "no such file or directory");
            }
            if (src.isDirectory) {
                throw fsError(EISDIR, from.vpath, "illegal operation on a directory");
            }
            write(to, streamOf(from));
        }

        /** SAF uri for a path (used as EXTRA_INITIAL_URI); null when it doesn't resolve. */
        public Uri documentUri(String path) {
            try {
                Loc loc = parse(path);
                if (loc.kind == Kind.DOC) {
                    return loc.grant.uri;
                }
                if (loc.kind != Kind.TREE) {
                    return null;
                }
                Walk w = walk(loc);
                if (w.blockedByFile) {
                    return null;
                }
                // Missing tail segments: fall back to the deepest existing directory.
                return docUri(loc, w.docId);
            } catch (Exception e) {
                return null;
            }
        }
    }
}
