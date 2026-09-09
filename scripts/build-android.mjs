import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "./build-android-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const env = { ...process.env };
if (windows) {
  const java = path.join(env.ProgramFiles || "C:/Program Files", "Android/Android Studio/jbr");
  const sdk = path.join(env.LOCALAPPDATA || "", "Android/Sdk");
  if (!env.JAVA_HOME && existsSync(java)) env.JAVA_HOME = java;
  if (!env.ANDROID_HOME && existsSync(sdk)) env.ANDROID_HOME = sdk;
}

const build = spawnSync(windows ? "gradlew.bat" : "./gradlew", [
  ":app:assembleDebug", ":app:testDebugUnitTest", ":app:lintDebug", "--console=plain",
], { cwd: path.join(root, "android"), stdio: "inherit", env, shell: windows });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const output = path.join(root, "artifacts/archviz-debug.apk");
await mkdir(path.dirname(output), { recursive: true });
await copyFile(path.join(root, "android/app/build/outputs/apk/debug/app-debug.apk"), output);
const download = path.join(root, "public/downloads/archviz.apk");
await mkdir(path.dirname(download), { recursive: true });
await copyFile(output, download);
console.log(`\nInstallable debug APK: ${output}`);
console.log(`Website download: ${download}`);