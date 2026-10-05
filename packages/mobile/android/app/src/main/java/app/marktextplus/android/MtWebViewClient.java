package app.marktextplus.android;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's client with the app's own origins in front: community plugin hosts
 * ({@code https://<id>.plugin.local}) and vault images ({@code https://vault.local}).
 */
public class MtWebViewClient extends BridgeWebViewClient {

    private final PluginRequestHandler plugins;
    private final VaultRequestHandler vault;

    public MtWebViewClient(Bridge bridge) {
        super(bridge);
        this.plugins = new PluginRequestHandler(bridge.getContext());
        this.vault = new VaultRequestHandler(bridge.getContext());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse plugin = plugins.handle(request);
        if (plugin != null) {
            return plugin;
        }
        WebResourceResponse response = vault.handle(request);
        if (response != null) {
            return response;
        }
        return super.shouldInterceptRequest(view, request);
    }
}
