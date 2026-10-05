package app.marktextplus.android;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Responses for {@code https://<id>.plugin.local/<path>}: the files of an installed community
 * plugin, the Android counterpart of desktop {@code main/community/serve.ts} and {@code paths.ts}.
 *
 * <p>Plugin files live in {@code <filesDir>/plugins/<id>/}. A plugin is served only while the
 * WebView side has written its host documents to {@code <filesDir>/plugin-host/<id>/}
 * ({@code bootstrap.html}, {@code bootstrap.js}, {@code csp.txt}), which it does for enabled
 * plugins only. Every response carries that plugin's CSP. Free of Android classes so the JVM
 * unit tests exercise it directly.
 */
final class PluginFileServer {

    static final String HOST_SUFFIX = ".plugin.local";
    static final long MAX_FILE_BYTES = 8L * 1024 * 1024;

    /** Same as {@code PLUGIN_ID_PATTERN} in shared/plugins/community.ts. */
    private static final Pattern PLUGIN_ID = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$");
    private static final String FALLBACK_CSP = "default-src 'none'";
    private static final Map<String, String> CONTENT_TYPES = new HashMap<>();

    static {
        CONTENT_TYPES.put("html", "text/html");
        CONTENT_TYPES.put("js", "text/javascript");
        CONTENT_TYPES.put("mjs", "text/javascript");
        CONTENT_TYPES.put("css", "text/css");
        CONTENT_TYPES.put("json", "application/json");
        CONTENT_TYPES.put("svg", "image/svg+xml");
        CONTENT_TYPES.put("png", "image/png");
        CONTENT_TYPES.put("jpg", "image/jpeg");
        CONTENT_TYPES.put("jpeg", "image/jpeg");
        CONTENT_TYPES.put("gif", "image/gif");
        CONTENT_TYPES.put("webp", "image/webp");
        CONTENT_TYPES.put("txt", "text/plain");
        CONTENT_TYPES.put("map", "application/json");
    }

    /** One HTTP response; {@code charset} is null for binary types. */
    static final class Response {

        final int status;
        final String reason;
        final String mimeType;
        final String charset;
        final Map<String, String> headers;
        final byte[] body;

        Response(int status, String reason, String mimeType, String charset, Map<String, String> headers, byte[] body) {
            this.status = status;
            this.reason = reason;
            this.mimeType = mimeType;
            this.charset = charset;
            this.headers = Collections.unmodifiableMap(headers);
            this.body = body;
        }
    }

    private final File pluginsRoot;
    private final File hostRoot;

    PluginFileServer(File filesDir) {
        this.pluginsRoot = new File(filesDir, "plugins");
        this.hostRoot = new File(filesDir, "plugin-host");
    }

    /**
     * Response for a request to {@code host} with the raw (still percent-encoded) URL path, or
     * null when {@code host} is not a plugin host.
     */
    Response serve(String host, String encodedPath) {
        if (host == null) return null;
        String lowerHost = host.toLowerCase(Locale.ROOT);
        if (!lowerHost.endsWith(HOST_SUFFIX)) return null;
        String id = lowerHost.substring(0, lowerHost.length() - HOST_SUFFIX.length());
        if (!PLUGIN_ID.matcher(id).matches()) return text(404, FALLBACK_CSP, "not found");

        File hostDir = new File(hostRoot, id);
        String csp = readCsp(hostDir);
        if (csp == null) return text(403, FALLBACK_CSP, "disabled");

        String relative = safeRelativePath(encodedPath == null ? "/" : encodedPath);
        if (relative == null) return text(400, csp, "bad path");

        if (relative.equals("__mt/bootstrap.html") || relative.equals("__mt/bootstrap.js")) {
            File document = new File(hostDir, relative.substring("__mt/".length()));
            byte[] body = readSmallFile(document);
            if (body == null) return text(404, csp, "not found");
            return ok(csp, relative.endsWith(".html") ? "text/html" : "text/javascript", body);
        }
        if (relative.equals("__mt") || relative.startsWith("__mt/")) return text(404, csp, "not found");

        File file = resolvePluginFile(new File(pluginsRoot, id), relative);
        if (file == null) return text(404, csp, "not found");
        if (file.length() > MAX_FILE_BYTES) return text(413, csp, "too large");
        byte[] body = readSmallFile(file);
        if (body == null) return text(404, csp, "not found");
        String type = CONTENT_TYPES.get(extensionOf(file.getName()));
        return ok(csp, type == null ? "application/octet-stream" : type, body);
    }

    /**
     * Relative path inside the plugin, or null when {@code encodedPath} is not a safe relative
     * path. Decodes once, like the URL parser plus the single decode of desktop
     * {@code safeRelativePath}, so {@code %2e%2e%2f} cannot hide {@code ../}.
     */
    static String safeRelativePath(String encodedPath) {
        if (encodedPath.isEmpty() || encodedPath.indexOf('\0') >= 0 || encodedPath.indexOf('\\') >= 0) return null;
        String decoded = percentDecode(encodedPath);
        if (decoded == null) return null;
        for (char forbidden : new char[] {'\0', '\\', '\n', '\r'}) {
            if (decoded.indexOf(forbidden) >= 0) return null;
        }
        int start = 0;
        while (start < decoded.length() && decoded.charAt(start) == '/') start++;
        String trimmed = decoded.substring(start);
        if (trimmed.isEmpty()) return null;
        for (String segment : trimmed.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        return trimmed;
    }

    /**
     * The file {@code relative} names inside {@code root}, or null when it escapes {@code root}
     * (also through a symlink), is not a regular file, or {@code root} is not a real directory.
     */
    static File resolvePluginFile(File root, String relative) {
        try {
            if (!root.isDirectory() || isSymlink(root)) return null;
            String rootPath = root.getCanonicalPath();
            File candidate = new File(root, relative).getCanonicalFile();
            if (!candidate.getPath().startsWith(rootPath + File.separator)) return null;
            return candidate.isFile() ? candidate : null;
        } catch (IOException e) {
            return null;
        }
    }

    /** RFC 3986 percent-decoding as UTF-8; unlike URLDecoder, '+' stays '+'. Null when malformed. */
    private static String percentDecode(String value) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c != '%') {
                byte[] encoded = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
                bytes.write(encoded, 0, encoded.length);
                continue;
            }
            if (i + 2 >= value.length()) return null;
            int high = Character.digit(value.charAt(i + 1), 16);
            int low = Character.digit(value.charAt(i + 2), 16);
            if (high < 0 || low < 0) return null;
            bytes.write((high << 4) | low);
            i += 2;
        }
        byte[] raw = bytes.toByteArray();
        String decoded = new String(raw, StandardCharsets.UTF_8);
        // Invalid UTF-8 would decode to U+FFFD; desktop decodeURIComponent rejects it.
        return Arrays.equals(decoded.getBytes(StandardCharsets.UTF_8), raw) ? decoded : null;
    }

    /** Whether {@code file} itself (not an ancestor) is a symlink; java.nio.file needs API 26. */
    private static boolean isSymlink(File file) throws IOException {
        File parent = file.getAbsoluteFile().getParentFile();
        if (parent == null) return false;
        return !new File(parent.getCanonicalFile(), file.getName()).getPath().equals(file.getCanonicalPath());
    }

    private static String readCsp(File hostDir) {
        byte[] csp = readSmallFile(new File(hostDir, "csp.txt"));
        return csp == null ? null : new String(csp, StandardCharsets.UTF_8).trim();
    }

    private static byte[] readSmallFile(File file) {
        if (!file.isFile() || file.length() > MAX_FILE_BYTES) return null;
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) file.length());
            byte[] buffer = new byte[8192];
            for (int read; (read = in.read(buffer)) != -1; ) {
                out.write(buffer, 0, read);
                if (out.size() > MAX_FILE_BYTES) return null;
            }
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static Map<String, String> headers(String csp) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Security-Policy", csp);
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        // The plugin frames are sandboxed without allow-same-origin (origin "null"), and module
        // scripts are always fetched in CORS mode; plugin files are not secret.
        headers.put("Access-Control-Allow-Origin", "*");
        return headers;
    }

    private static Response ok(String csp, String mimeType, byte[] body) {
        boolean text = mimeType.startsWith("text/") || mimeType.equals("application/json");
        return new Response(200, "OK", mimeType, text ? "utf-8" : null, headers(csp), body);
    }

    private static Response text(int status, String csp, String body) {
        String reason;
        switch (status) {
            case 400:
                reason = "Bad Request";
                break;
            case 403:
                reason = "Forbidden";
                break;
            case 413:
                reason = "Payload Too Large";
                break;
            default:
                reason = "Not Found";
        }
        return new Response(status, reason, "text/plain", "utf-8", headers(csp), body.getBytes(StandardCharsets.UTF_8));
    }
}
