import type { CapacitorConfig } from '@capacitor/cli';
// appId must NEVER change after the first release: it is what lets a new APK update the old one and keep its database.
const config: CapacitorConfig = {
  appId: 'com.tawze3.app',
  appName: 'توزيع',
  webDir: 'dist',
  // Android 15 forces edge-to-edge drawing; Capacitor 7 only adds the system-bar margins when asked to.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: 'auto' },
};
export default config;
