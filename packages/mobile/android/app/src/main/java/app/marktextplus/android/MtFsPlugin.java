package app.marktextplus.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/**
 * File backend for the in-WebView mobile main process. All file work runs on one single-thread
 * executor so calls complete in submission order (a write followed by a read sees the write).
 */
@CapacitorPlugin(name = "MtFs")
public class MtFsPlugin extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> new Thread(r, "MtFs-io"));
    private MtFsPaths fs;

    @Override
    public void load() {
        fs = MtFsPaths.get(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
    }

    private interface Task {
        JSObject run(MtFsPaths.Op op) throws Exception;
    }

    private void submit(PluginCall call, String path, Task task) {
        io.execute(() -> {
            try {
                JSObject result = task.run(fs.begin());
                call.resolve(result != null ? result : new JSObject());
            } catch (Exception e) {
                reject(call, path, e);
            }
        });
    }

    private static void reject(PluginCall call, String path, Exception e) {
        if (e instanceof MtFsPaths.FsException) {
            call.reject(e.getMessage(), ((MtFsPaths.FsException) e).code);
            return;
        }
        String code;
        if (e instanceof SecurityException) {
            code = MtFsPaths.PERMISSION_DENIED;
        } else if (e instanceof FileNotFoundException) {
            code = MtFsPaths.ENOENT;
        } else {
            code = MtFsPaths.EIO;
        }
        call.reject(code + ": " + e.getMessage() + ", " + call.getMethodName() + " '" + path + "'", code);
    }

    /** Validates the encoding argument; null means utf8. */
    private static boolean isBase64(PluginCall call) throws MtFsPaths.FsException {
        String encoding = call.getString("encoding", "utf8");
        if ("base64".equals(encoding)) {
            return true;
        }
        if ("utf8".equals(encoding) || "utf-8".equals(encoding)) {
            return false;
        }
        throw new MtFsPaths.FsException(MtFsPaths.UNSUPPORTED_ON_ANDROID, "Unsupported encoding: " + encoding);
    }

    // ---------------------------------------------------------------------------------------------
    // File methods

    @PluginMethod
    public void stat(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            MtFsPaths.Info info = op.stat(path);
            JSObject out = new JSObject();
            out.put("exists", info != null);
            if (info != null) {
                out.put("isFile", !info.isDirectory);
                out.put("isDirectory", info.isDirectory);
                out.put("size", info.size);
                out.put("mtimeMs", info.mtimeMs);
                out.put("birthtimeMs", info.birthtimeMs);
            }
            return out;
        });
    }

    @PluginMethod
    public void readdir(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            List<MtFsPaths.Info> list = op.readdir(path);
            JSArray entries = new JSArray();
            for (MtFsPaths.Info info : list) {
                JSObject e = new JSObject();
                e.put("name", info.name);
                e.put("isFile", !info.isDirectory);
                e.put("isDirectory", info.isDirectory);
                e.put("size", info.size);
                e.put("mtimeMs", info.mtimeMs);
                entries.put(e);
            }
            JSObject out = new JSObject();
            out.put("entries", entries);
            return out;
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            boolean base64 = isBase64(call);
            byte[] bytes = op.readFile(path);
            JSObject out = new JSObject();
            out.put("data", base64 ? Base64.encodeToString(bytes, Base64.NO_WRAP) : new String(bytes, StandardCharsets.UTF_8));
            return out;
        });
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            boolean base64 = isBase64(call);
            String data = call.getString("data", "");
            byte[] bytes;
            try {
                bytes = base64 ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw new MtFsPaths.FsException(MtFsPaths.EIO, "EIO: invalid base64 data, '" + path + "'");
            }
            op.writeFile(path, out -> out.write(bytes));
            return null;
        });
    }

    @PluginMethod
    public void mkdirp(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            op.mkdirp(path);
            return null;
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String from = call.getString("from");
        String to = call.getString("to");
        submit(call, from + "' -> '" + to, op -> {
            op.rename(from, to);
            return null;
        });
    }

    @PluginMethod
    public void copy(PluginCall call) {
        String from = call.getString("from");
        String to = call.getString("to");
        submit(call, from + "' -> '" + to, op -> {
            op.copy(from, to);
            return null;
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String path = call.getString("path");
        submit(call, path, op -> {
            op.remove(path);
            return null;
        });
    }

    // ---------------------------------------------------------------------------------------------
    // Pickers

    private static JSObject picked(MtFsPaths.Picked p) {
        JSObject out = new JSObject();
        out.put("path", p.path);
        out.put("name", p.name);
        return out;
    }

    private static JSObject cancelled() {
        JSObject out = new JSObject();
        out.put("cancelled", true);
        return out;
    }

    private static Uri resultUri(ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            return null;
        }
        return result.getData().getData();
    }

    private static Intent withGrantFlags(Intent intent) {
        return intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = withGrantFlags(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE));
        intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "onPickDirectory");
    }

    @ActivityCallback
    private void onPickDirectory(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(cancelled());
            return;
        }
        submit(call, uri.toString(), op -> picked(fs.grantTree(uri)));
    }

    @PluginMethod
    public void pickOpenFile(PluginCall call) {
        Intent intent = withGrantFlags(new Intent(Intent.ACTION_OPEN_DOCUMENT));
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        JSArray mimeTypes = call.getArray("mimeTypes", new JSArray());
        try {
            List<String> types = mimeTypes.toList();
            if (!types.isEmpty()) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            }
        } catch (JSONException e) {
            call.reject("mimeTypes must be an array of strings", MtFsPaths.EIO);
            return;
        }
        startActivityForResult(call, intent, "onPickDocument");
    }

    @PluginMethod
    public void pickSaveFile(PluginCall call) {
        String suggestedName = call.getString("suggestedName", "");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String initialPath = call.getString("initialPath");
        // Resolving initialPath touches SAF, so it runs on the IO executor; the picker starts on the main thread.
        io.execute(() -> {
            Intent intent = withGrantFlags(new Intent(Intent.ACTION_CREATE_DOCUMENT));
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
            if (initialPath != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Uri initial = fs.begin().documentUri(initialPath);
                if (initial != null) {
                    intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial);
                }
            }
            getBridge().executeOnMainThread(() -> startActivityForResult(call, intent, "onPickDocument"));
        });
    }

    @ActivityCallback
    private void onPickDocument(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(cancelled());
            return;
        }
        submit(call, uri.toString(), op -> picked(fs.grantDocument(uri)));
    }

    // ---------------------------------------------------------------------------------------------
    // External links

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) {
            call.reject("Only http(s) and mailto links can be opened: " + url, MtFsPaths.UNSUPPORTED_ON_ANDROID);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app can open " + url, MtFsPaths.EIO);
        }
    }
}
