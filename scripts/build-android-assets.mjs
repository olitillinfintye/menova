import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "./build-archviz-brand.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const resources = path.join(root, "android/app/src/main/res");
const mark = path.join(root, "public/brand/archviz-mark.png");
const lockup = path.join(root, "public/brand/menova-lockup-dark.png");
const drawable = path.join(resources, "drawable-nodpi");
await mkdir(drawable, { recursive: true });
await sharp(mark).resize(432, 432, { fit: "contain", background: "#00000000" })
  .png().toFile(path.join(drawable, "menova_mark.png"));
await sharp(lockup).resize({ width: 660 }).png().toFile(path.join(drawable, "menova_lockup.png"));

for (const [density, size] of Object.entries({ mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 })) {
  const directory = path.join(resources, `mipmap-${density}`);
  await mkdir(directory, { recursive: true });
  const logo = await sharp(mark).resize(Math.round(size * 0.58), Math.round(size * 0.58), {
    fit: "contain", background: "#00000000",
  }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#00000000" } })
    .composite([{ input: logo, gravity: "centre" }]).png()
    .toFile(path.join(directory, "ic_launcher_foreground.png"));
}
console.log("Generated Menova Android launcher and splash assets.");