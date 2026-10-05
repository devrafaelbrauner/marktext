package app.marktextplus.android;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;

/**
 * Serves community plugins at {@code https://<id>.plugin.local/} from app-private storage (see
 * {@link PluginFileServer}). The app's WebViewClient asks this handler first in
 * {@code shouldInterceptRequest}; hosts that are not plugin hosts return null.
 */
public final class PluginRequestHandler {

    private static final String TAG = "MtPluginHost";

    private final PluginFileServer server;

    public PluginRequestHandler(Context context) {
        this.server = new PluginFileServer(context.getFilesDir());
    }

    /** The response for a plugin host request, or null to let the WebView handle it. */
    public WebResourceResponse handle(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"https".equals(url.getScheme())) return null;
        PluginFileServer.Response response = server.serve(url.getHost(), url.getEncodedPath());
        if (response == null) return null;
        if (response.status != 200) Log.w(TAG, response.status + " " + url.getHost() + url.getEncodedPath());
        return new WebResourceResponse(
            response.mimeType,
            response.charset,
            response.status,
            response.reason,
            response.headers,
            new ByteArrayInputStream(response.body)
        );
    }
}
