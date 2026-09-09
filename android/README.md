# Archviz Android

Android 8.0+ application for https://menova-flax.vercel.app/. The website and
server remain hosted on Vercel. An internet connection is required; the APK does
not contain the Next.js server, database, credentials, or an offline project cache.

## Features

- Adaptive Archviz launcher icon and native launch screen, including Android 12+.
- Animated brand loading screen with a 30-second timeout and connection retry.
- No native header; fresh launches open the main page, with system Back navigation.
- Open Archviz enters the workspace; Back to home returns to the main page.
- Archviz loading screen with a single Powered by Menova Studio company credit.
- Open XR in browser action within the viewer for supported browser XR.
- System model-file picker and PNG render Save As dialog, without broad storage permissions.
- HTTPS-only embedded navigation restricted to the Menova origin. External HTTPS,
  email, and phone links open in the appropriate system app. Invalid TLS certificates
  are rejected. No JavaScript-to-native bridge is exposed.

## Build

Install the website dependencies with `npm install` from the repository root.
Install Android Studio with SDK platform 35 and build-tools 35.0.0. The build uses
Gradle 8.13 and requires JDK 17 or newer (Android Studio's bundled JDK works).
Set `JAVA_HOME` and `ANDROID_HOME` for nonstandard installations. Standard Windows
Android Studio paths are detected automatically by the build script.

From the repository root:

```powershell
npm run android:build
```

This generates icons from the existing brand PNGs, compiles a debug APK, runs
navigation-policy unit tests and Android lint, then copies the APK to
`artifacts/archviz-debug.apk` and `public/downloads/archviz.apk`. The website serves
the latter through its Download APK button. Asset generation uses `sharp`, also used by
the existing brand-asset script and installed with Next.js.

Alternatively, open this folder as a project in Android Studio, or use the checked-in
Gradle wrapper. Generated brand assets are checked in so Gradle alone can build it:

```powershell
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

On macOS/Linux, use `sh ./gradlew assembleDebug testDebugUnitTest lintDebug`.

## Install

Use the website's Download APK button, or open `artifacts/archviz-debug.apk` on the phone. Allow
"Install unknown apps" for the file manager used to open this APK when Android
prompts. Alternatively, connect a phone with USB debugging enabled:

```powershell
adb install -r artifacts/archviz-debug.apk
```

The supplied APK is debug-signed for testing and direct installation, not a Play
Store release. Use Android Studio's Generate Signed App Bundle / APK flow with
your own private signing key for distribution. Never commit signing keys/passwords.

## Configuration And Limits

- Change `SITE_URL` in `app/build.gradle` and rebuild to point at another HTTPS
  deployment. The navigation allowlist derives from this URL.
- Website updates appear automatically. Native changes require rebuilding and
  reinstalling the APK. Sign updates with the same key and raise `versionCode`.
- WebXR/AR requires a supported browser such as Android Chrome. Use Open XR in
  browser from the viewer; Android WebView does not provide equivalent WebXR support.
- The existing website's authentication, permissions, and upload restrictions
  still apply. This wrapper does not add login or bypass server authorization.
- PNG captures use the system save dialog. HTTPS downloads use Android's download
  manager in app-specific storage (removed on uninstall); `blob:` downloads are not
  supported and should be opened in the browser instead.
- The debug build enables WebView inspection over authorized ADB for testing.
  Release builds disable it.

## Phone Smoke Test

Build and lint do not replace testing on a phone. Check launch and loading animation,
launcher icon, dashboard and viewer navigation, Back, portrait/landscape, keyboard,
airplane-mode retry, upload selection/cancellation, render saving, and browser AR.