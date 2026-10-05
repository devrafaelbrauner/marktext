package app.marktextplus.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plugin secrets (API keys of {@code secret} settings), the Android counterpart of desktop
 * {@code main/security/secretsStore.ts}. Each value is encrypted with AES-256-GCM under a
 * non-exportable Android Keystore key (alias {@code marktext-secrets}, usable without user
 * authentication) and stored as IV plus ciphertext in private SharedPreferences. The slot name
 * is bound as associated data, so a ciphertext copied to another slot fails to decrypt.
 *
 * <p>Values do not travel as Capacitor plugin calls: debug builds log every call's arguments and
 * results to Logcat. The WebView side talks to a {@code window.mtSecrets} message channel
 * instead, injected only into the app's own top-level document (Capacitor's allowed origins,
 * main frame only), so sandboxed plugin frames never see it. Values are never logged.
 */
@CapacitorPlugin(name = "MtSecrets")
public class MtSecretsPlugin extends Plugin {

    private static final String TAG = "MtSecrets";
    private static final String CHANNEL = "mtSecrets";
    private static final String KEY_ALIAS = "marktext-secrets";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "marktext-secrets";
    private static final String FORMAT = "v1";
    private static final int TAG_BITS = 128;
    /** Separates namespace and key in a preference name; neither may contain it. */
    private static final char SEPARATOR = '\u001f';

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.e(TAG, "WebView without WEB_MESSAGE_LISTENER: plugin secrets are unavailable");
            return;
        }
        WebViewCompat.addWebMessageListener(webView, CHANNEL, getBridge().getAllowedOriginRules(), this::onMessage);
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (!isMainFrame || message.getData() == null) return;
        String data = message.getData();
        worker.execute(() -> {
            String response = respond(data);
            main.post(() -> reply.postMessage(response));
        });
    }

    /** Handles one request {@code {id, op, namespace?, key?, value?}}; replies {@code {id, ok, ...}}. */
    private String respond(String data) {
        JSONObject response = new JSONObject();
        try {
            JSONObject request = new JSONObject(data);
            response.put("id", request.opt("id"));
            String op = request.optString("op");
            if (op.equals("list")) {
                response.put("namespaces", list());
            } else {
                String slot = slotOf(request.optString("namespace"), request.optString("key"));
                switch (op) {
                    case "get":
                        response.put("value", get(slot));
                        break;
                    case "set":
                        if (!request.has("value") || !(request.get("value") instanceof String)) {
                            throw new IllegalArgumentException("value must be a string");
                        }
                        set(slot, request.getString("value"));
                        break;
                    case "delete":
                        prefs().edit().remove(slot).commit();
                        Log.i(TAG, "deleted " + describe(slot));
                        break;
                    default:
                        throw new IllegalArgumentException("unknown operation");
                }
            }
            response.put("ok", true);
        } catch (JSONException | RuntimeException | GeneralSecurityException e) {
            try {
                response.put("ok", false);
                response.put("error", e instanceof GeneralSecurityException ? "The Android Keystore is unavailable" : e.getMessage());
            } catch (JSONException ignored) {
                // Unreachable: string values always serialize.
            }
            if (e instanceof GeneralSecurityException) Log.e(TAG, "keystore failure: " + e.getClass().getSimpleName());
        }
        return response.toString();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSONObject list() throws JSONException {
        Map<String, JSONArray> byNamespace = new TreeMap<>();
        for (String slot : prefs().getAll().keySet()) {
            int split = slot.indexOf(SEPARATOR);
            if (split <= 0) continue;
            String namespace = slot.substring(0, split);
            JSONArray keys = byNamespace.get(namespace);
            if (keys == null) {
                keys = new JSONArray();
                byNamespace.put(namespace, keys);
            }
            keys.put(slot.substring(split + 1));
        }
        JSONObject namespaces = new JSONObject();
        for (Map.Entry<String, JSONArray> entry : byNamespace.entrySet()) namespaces.put(entry.getKey(), entry.getValue());
        return namespaces;
    }

    /** The stored value, or {@link JSONObject#NULL} when unset or no longer decryptable. */
    private Object get(String slot) {
        String stored = prefs().getString(slot, null);
        if (stored == null) return JSONObject.NULL;
        try {
            String value = decrypt(slot, stored);
            Log.i(TAG, "decrypted " + describe(slot) + " with the Keystore key");
            return value;
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            // The Keystore key is gone (app data restored on another device, key invalidated):
            // the ciphertext can never be read again, so the secret counts as unset.
            Log.w(TAG, "dropping unreadable " + describe(slot) + ": " + e.getClass().getSimpleName());
            prefs().edit().remove(slot).commit();
            return JSONObject.NULL;
        }
    }

    private void set(String slot, String value) throws GeneralSecurityException {
        String encrypted = encrypt(slot, value);
        if (!prefs().edit().putString(slot, encrypted).commit()) throw new IllegalArgumentException("Could not save the secret");
        Log.i(TAG, "stored " + describe(slot) + " encrypted with the Keystore key (" + encrypted.length() + " encoded chars)");
    }

    private static String slotOf(String namespace, String key) {
        if (namespace.isEmpty() || key.isEmpty()) throw new IllegalArgumentException("namespace and key are required");
        if (namespace.indexOf(SEPARATOR) >= 0 || key.indexOf(SEPARATOR) >= 0) {
            throw new IllegalArgumentException("namespace and key must not contain U+001F");
        }
        return namespace + SEPARATOR + key;
    }

    private static String describe(String slot) {
        return "secret " + slot.replace(SEPARATOR, '/');
    }

    private static synchronized SecretKey secretKey() throws GeneralSecurityException {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
            }
        } catch (IOException e) {
            throw new GeneralSecurityException(e);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build()
        );
        Log.i(TAG, "created Keystore key " + KEY_ALIAS);
        return generator.generateKey();
    }

    /** {@code v1:<base64 IV>:<base64 ciphertext+tag>}; the Keystore picks a fresh random IV. */
    private static String encrypt(String slot, String value) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return FORMAT + ":" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
    }

    private static String decrypt(String slot, String stored) throws GeneralSecurityException {
        String[] parts = stored.split(":", -1);
        if (parts.length != 3 || !FORMAT.equals(parts[0])) throw new IllegalArgumentException("unknown secret format");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(TAG_BITS, Base64.decode(parts[1], Base64.NO_WRAP)));
        cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
