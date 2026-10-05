package app.marktextplus.android;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the area behind the status and navigation bars with the editor theme's background and
 * picks bar icons that stay readable on it. The app theme is a user preference, so it does not
 * follow the system night mode Capacitor's SystemBars plugin uses.
 */
@CapacitorPlugin(name = "MtSystemBars")
public class MtSystemBarsPlugin extends Plugin {

    @PluginMethod
    public void apply(PluginCall call) {
        String color = call.getString("color");
        Boolean dark = call.getBoolean("dark");
        if (color == null || dark == null) {
            call.reject("color and dark are required");
            return;
        }
        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + color);
            return;
        }
        getBridge().executeOnMainThread(() -> {
            Window window = getActivity().getWindow();
            window.getDecorView().setBackgroundColor(parsed);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
