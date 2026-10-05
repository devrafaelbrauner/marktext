import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.marktextplus.android',
  appName: 'MarkText Plus',
  webDir: 'dist',
  android: {
    // The renderer never needs http:// content; vault, plugin and bundle
    // origins are all https served by the native interceptor.
    allowMixedContent: false,
    webContentsDebuggingEnabled: true
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost'
  },
  plugins: {
    // Native fetch from plugin main code goes through CapacitorHttp
    // explicitly (src/main/plugins/net.ts); window.fetch stays the WebView's.
    CapacitorHttp: { enabled: false },
    Keyboard: { resize: 'native' },
    SplashScreen: { launchAutoHide: true, launchShowDuration: 0 }
  }
}

export default config
