package app.marktextplus.android;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MtSecretsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
