package app.marktextplus.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Plugin secrets (API keys of {@code secret} settings), the Android counterpart of desktop
 * {@code main/security/secretsStore.ts}. Each value is encrypted with AES-256-GCM under a
 * non-exportable Android Keystore key (alias {@code marktext-secrets}, usable without user
 * authentication) and stored as IV plus ciphertext in private SharedPreferences. The slot name
 * is bound as associated data, so a ciphertext copied to another slot fails to decrypt. Values
 * are never logged.
 */
@CapacitorPlugin(name = "MtSecrets")
public class MtSecretsPlugin extends Plugin {

    private static final String TAG = "MtSecrets";
    private static final String KEY_ALIAS = "marktext-secrets";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "marktext-secrets";
    private static final String FORMAT = "v1";
    private static final int TAG_BITS = 128;
    /** Separates namespace and key in a preference name; neither may contain it. */
    private static final char SEPARATOR = '\u001f';

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void list(PluginCall call) {
        Map<String, JSArray> byNamespace = new TreeMap<>();
        for (String slot : prefs().getAll().keySet()) {
            int split = slot.indexOf(SEPARATOR);
            if (split <= 0) continue;
            String namespace = slot.substring(0, split);
            JSArray keys = byNamespace.get(namespace);
            if (keys == null) {
                keys = new JSArray();
                byNamespace.put(namespace, keys);
            }
            keys.put(slot.substring(split + 1));
        }
        JSObject namespaces = new JSObject();
        for (Map.Entry<String, JSArray> entry : byNamespace.entrySet()) namespaces.put(entry.getKey(), entry.getValue());
        JSObject result = new JSObject();
        result.put("namespaces", namespaces);
        call.resolve(result);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String slot = slotOf(call);
        if (slot == null) return;
        String stored = prefs().getString(slot, null);
        JSObject result = new JSObject();
        if (stored == null) {
            result.put("value", JSObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            result.put("value", decrypt(slot, stored));
            Log.d(TAG, "decrypted " + describe(slot));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            // The Keystore key is gone (app data restored on another device, key invalidated):
            // the ciphertext can never be read again, so the secret counts as unset.
            Log.w(TAG, "dropping unreadable " + describe(slot) + ": " + e.getClass().getSimpleName());
            prefs().edit().remove(slot).commit();
            result.put("value", JSObject.NULL);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String slot = slotOf(call);
        if (slot == null) return;
        String value = call.getString("value");
        if (value == null) {
            call.reject("value must be a string", "BAD_ARGS");
            return;
        }
        try {
            String encrypted = encrypt(slot, value);
            if (!prefs().edit().putString(slot, encrypted).commit()) {
                call.reject("Could not save the secret", "EIO");
                return;
            }
            Log.i(TAG, "stored " + describe(slot) + " (" + encrypted.length() + " encoded chars)");
            call.resolve();
        } catch (GeneralSecurityException e) {
            Log.e(TAG, "encrypting " + describe(slot) + " failed: " + e.getClass().getSimpleName());
            call.reject("The Android Keystore is unavailable", "UNAVAILABLE", e);
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String slot = slotOf(call);
        if (slot == null) return;
        prefs().edit().remove(slot).commit();
        Log.i(TAG, "deleted " + describe(slot));
        call.resolve();
    }

    /** Preference name for the call's namespace and key, or null after rejecting the call. */
    private static String slotOf(PluginCall call) {
        String namespace = call.getString("namespace");
        String key = call.getString("key");
        if (namespace == null || namespace.isEmpty() || key == null || key.isEmpty()) {
            call.reject("namespace and key are required", "BAD_ARGS");
            return null;
        }
        if (namespace.indexOf(SEPARATOR) >= 0 || key.indexOf(SEPARATOR) >= 0) {
            call.reject("namespace and key must not contain U+001F", "BAD_ARGS");
            return null;
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
