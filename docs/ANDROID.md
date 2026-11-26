# Building the Android APK (Windows + WSL)

> **Status: the Android project is generated and plugin-synced, but an APK was NOT built or run in the environment where this code was written
> (no Android SDK there).** Follow these steps on your computer; the first build is the real test. Please report any error text.

## 1. Prerequisites
| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or 22 LTS | `node -v` |
| JDK | **17** | `java -version`. Capacitor 7 / Gradle 8.11 need JDK 17 |
| Android SDK | platform 35, build-tools 35.x | install Android Studio (easiest) or the command-line tools |
| Gradle | not needed | the project ships `gradlew` (Gradle 8.11.1, downloaded on first run, needs internet once) |

### Recommended: build on Windows with Android Studio
WSL cannot talk to a USB phone easily. Simplest path: keep the repo on Windows (or in WSL and open it from `\\wsl$\...`), install Android Studio on Windows, and open the `android/` folder.

### Building fully inside WSL Ubuntu (command line)
```bash
sudo apt update && sudo apt install -y openjdk-17-jdk unzip curl
mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
# download "Command line tools for Linux" from https://developer.android.com/studio#command-tools , unzip, rename the folder to "latest"
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
echo "sdk.dir=$ANDROID_HOME" > ~/tawze3/android/local.properties   # local.properties is git-ignored
```
Put the two `export` lines in `~/.bashrc`.

## 2. Build the web bundle and sync it into the Android project
```bash
cd tawze3
npm install
npm test && npm run typecheck
npm run android:sync        # = vite build + `cap sync android` (copies dist/ and registers the plugins)
```
Run `npm run android:sync` again after EVERY change to the web code.

## 3a. Debug APK (for testing; signed with an automatic debug key)
```bash
npm run android:debug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

## 3b. Release APK (the one you give to the owner)
1. Create a signing key ONCE (keep it forever, see below):
```bash
keytool -genkeypair -v -keystore tawze3-release.keystore -alias tawze3 -keyalg RSA -keysize 2048 -validity 10000
```
2. `cp android/keystore.properties.example android/keystore.properties` and fill in the passwords and the keystore path.
3. Build:
```bash
npm run android:release
# output: android/app/build/outputs/apk/release/app-release.apk
```
If `keystore.properties` is missing the build produces `app-release-unsigned.apk`, which Android refuses to install.

### Debug vs release
Debug: debuggable, signed with a throw-away key, only for testing. Release: optimized, signed with YOUR key.
An app can only be updated by an APK signed with the **same key and same applicationId** (`com.tawze3.app`).

### Keep the signing key safe
Back up `tawze3-release.keystore` and its passwords in at least two private places (never in Git, never in chat).
**If you lose it, you cannot update the installed app: the owner would have to uninstall (losing local data unless a backup file exists) and reinstall.**

## 4. Install and test
- Phone: Settings, Security, allow "install unknown apps" for the app you use to open the APK (Files, WhatsApp, Chrome). Copy the APK to the phone and open it.
- USB: enable Developer options and USB debugging, then `adb install -r android/app/build/outputs/apk/release/app-release.apk`
  (`-r` keeps the data when updating).
- Emulator: Android Studio, Device Manager, create a device (API 34/35), then Run.

## 5. Checklist for the first run on a real phone (nobody has done this yet)
1. App opens, Arabic RTL, nothing hidden behind the status bar or navigation bar (`adjustMarginsForEdgeToEdge: auto` is set for Android 15; if it overlaps, try `'force'` in `capacitor.config.ts`, then `npm run android:sync`).
2. Add a unit, product, customer, supplier; record a purchase and a sale; close the app completely and reopen: **the data must still be there** (this is the native SQLite check).
3. Invoice > PDF / PNG / WhatsApp opens the share sheet and the file opens correctly.
4. Set a PIN, send the app to the background for over 30 seconds, return: the lock screen appears. Enable the fingerprint option if offered.
5. Backup > create a backup, then restore it.
6. Leave the app open past midnight or change the date: an automatic backup appears in Backup > the daily list.

## Versions and updates
In `android/app/build.gradle` bump `versionCode` (integer, must increase every release) and `versionName` for each new APK. Keep `applicationId` unchanged.
Installing a newer APK over the old one (same key) keeps the database. See `docs/UPDATING.md`.

## Permissions
The manifest declares only `INTERNET` (added by the Capacitor template; the app never makes network requests) plus what the plugins merge in (biometrics).
You may try removing INTERNET (`<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />`) after verifying on a device that the app still loads; this has not been tested.
Android "Auto Backup" (`allowBackup=true`) may copy app data to the owner's Google account on devices where that is enabled; set it to `false` in `AndroidManifest.xml` if that is not wanted.
