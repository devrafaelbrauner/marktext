package app.marktextplus.android;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's client plus the vault.local image handler. Plugin hosts ({@code *.plugin.local}) are
 * served by the sibling PluginRequestHandler, wired in here by the integrator.
 */
public class MtWebViewClient extends BridgeWebViewClient {

    private final VaultRequestHandler vault;

    public MtWebViewClient(Bridge bridge) {
        super(bridge);
        this.vault = new VaultRequestHandler(bridge.getContext());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse response = vault.handle(request);
        if (response != null) {
            return response;
        }
        return super.shouldInterceptRequest(view, request);
    }
}
