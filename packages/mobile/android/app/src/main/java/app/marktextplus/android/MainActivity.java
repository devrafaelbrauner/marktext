package app.marktextplus.android;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MtFsPlugin.class);
        registerPlugin(MtSecretsPlugin.class);
        registerPlugin(MtSystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new MtWebViewClient(bridge));
    }
}
