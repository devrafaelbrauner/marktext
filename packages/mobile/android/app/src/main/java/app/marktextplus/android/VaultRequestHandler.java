package app.marktextplus.android;

import android.content.Context;
import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Serves images from granted vaults, single documents and selected app-private folders at
 * {@code https://vault.local/<encodeURIComponent(segment)>/...} so the renderer can display them.
 */
public class VaultRequestHandler {

    private static final String TAG = "MtFsVault";
    private static final String HOST = "vault.local";
    private static final String SVG_CSP =
        "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
    private static final Set<String> PRIVATE_FOLDERS = new HashSet<>(Arrays.asList("images", "screenshot", "themes"));
    private static final Map<String, String> IMAGE_TYPES = new HashMap<>();

    static {
        IMAGE_TYPES.put("png", "image/png");
        IMAGE_TYPES.put("jpg", "image/jpeg");
        IMAGE_TYPES.put("jpeg", "image/jpeg");
        IMAGE_TYPES.put("gif", "image/gif");
        IMAGE_TYPES.put("svg", "image/svg+xml");
        IMAGE_TYPES.put("webp", "image/webp");
        IMAGE_TYPES.put("bmp", "image/bmp");
        IMAGE_TYPES.put("ico", "image/x-icon");
        IMAGE_TYPES.put("avif", "image/avif");
        IMAGE_TYPES.put("apng", "image/apng");
    }

    private final MtFsPaths fs;

    public VaultRequestHandler(Context context) {
        this.fs = MtFsPaths.get(context);
    }

    /** Returns null when the request is not for vault.local. */
    public WebResourceResponse handle(WebResourceRequest req) {
        Uri url = req.getUrl();
        if (url == null || !HOST.equalsIgnoreCase(url.getHost())) {
            return null;
        }
        if (!"GET".equalsIgnoreCase(req.getMethod())) {
            return error(405, "Method Not Allowed");
        }
        List<String> segs = decodeSegments(url.getEncodedPath());
        if (segs == null) {
            return error(400, "Bad Request");
        }
        if (!isAllowedRoot(segs)) {
            return error(403, "Forbidden");
        }
        String name = segs.get(segs.size() - 1);
        int dot = name.lastIndexOf('.');
        String mime = dot < 0 ? null : IMAGE_TYPES.get(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        if (mime == null) {
            return error(403, "Forbidden");
        }
        String vpath = "/" + TextUtils.join("/", segs);
        try {
            MtFsPaths.Op op = fs.begin();
            MtFsPaths.Info info = op.stat(vpath);
            if (info == null) {
                return error(404, "Not Found");
            }
            if (info.isDirectory) {
                return error(403, "Forbidden");
            }
            return ok(mime, op.openInput(vpath));
        } catch (MtFsPaths.FsException e) {
            switch (e.code) {
                case MtFsPaths.ENOENT:
                case MtFsPaths.ENOTDIR:
                    return error(404, "Not Found");
                case MtFsPaths.PERMISSION_DENIED:
                case MtFsPaths.EISDIR:
                    return error(403, "Forbidden");
                default:
                    return error(500, "Internal Server Error");
            }
        } catch (SecurityException e) {
            return error(403, "Forbidden");
        } catch (java.io.FileNotFoundException e) {
            return error(404, "Not Found");
        } catch (Exception e) {
            Log.w(TAG, "Failed to serve " + vpath, e);
            return error(500, "Internal Server Error");
        }
    }

    /** Only /vault/..., /doc/... and /data/marktext/{images,screenshot,themes}/... are served. */
    private static boolean isAllowedRoot(List<String> segs) {
        if (segs.isEmpty()) {
            return false;
        }
        String root = segs.get(0);
        if (root.equals("vault") || root.equals("doc")) {
            return true;
        }
        return root.equals("data") && segs.size() >= 4 && segs.get(1).equals("marktext") && PRIVATE_FOLDERS.contains(segs.get(2));
    }

    /**
     * Percent-decodes each path segment as strict UTF-8 ('+' stays literal). Returns null for
     * malformed escapes or dot-segments, separators, backslashes and NUL (raw or encoded).
     */
    static List<String> decodeSegments(String encodedPath) {
        if (encodedPath == null) {
            return null;
        }
        List<String> out = new ArrayList<>();
        for (String raw : encodedPath.split("/")) {
            if (raw.isEmpty()) {
                continue;
            }
            String seg = percentDecode(raw);
            if (
                seg == null ||
                seg.isEmpty() ||
                seg.equals(".") ||
                seg.equals("..") ||
                seg.indexOf('/') >= 0 ||
                seg.indexOf('\\') >= 0 ||
                seg.indexOf('\0') >= 0
            ) {
                return null;
            }
            out.add(seg);
        }
        return out;
    }

    private static String percentDecode(String s) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%') {
                if (i + 2 >= s.length()) {
                    return null;
                }
                int hi = Character.digit(s.charAt(i + 1), 16);
                int lo = Character.digit(s.charAt(i + 2), 16);
                if (hi < 0 || lo < 0) {
                    return null;
                }
                bytes.write((hi << 4) | lo);
                i += 2;
            } else if (c < 0x80) {
                bytes.write(c);
            } else {
                byte[] enc = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
                bytes.write(enc, 0, enc.length);
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    private static Map<String, String> baseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "https://localhost");
        return headers;
    }

    private static WebResourceResponse ok(String mime, InputStream body) {
        Map<String, String> headers = baseHeaders();
        headers.put("Content-Type", mime);
        if (mime.equals("image/svg+xml")) {
            headers.put("Content-Security-Policy", SVG_CSP);
        }
        return new WebResourceResponse(mime, null, 200, "OK", headers, body);
    }

    private static WebResourceResponse error(int status, String reason) {
        Map<String, String> headers = baseHeaders();
        headers.put("Content-Type", "text/plain; charset=utf-8");
        byte[] body = (status + " " + reason).getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/plain", "utf-8", status, reason, headers, new ByteArrayInputStream(body));
    }
}
