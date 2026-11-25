import type { CapacitorConfig } from '@capacitor/cli';
// appId must NEVER change after the first release: it is what lets a new APK update the old one and keep its database.
const config: CapacitorConfig = {
  appId: 'com.tawze3.app',
  appName: 'tawze3',
  webDir: 'dist',
  android: { allowMixedContent: false },
};
export default config;
