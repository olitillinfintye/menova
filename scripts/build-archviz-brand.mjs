import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const brand = path.join(root, "public/brand");
await mkdir(brand, { recursive: true });
const symbol = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<path fill="#36bfa6" fill-rule="evenodd" d="M80 432V208a176 176 0 0 1 352 0v224h-64V208a112 112 0 0 0-224 0v224Z"/>
<path fill="#f3f7f5" d="M224 224h64v208h-64z"/>
<path fill="#ee987c" d="M176 368h160v32H176z"/>
</svg>`);
await sharp(symbol).png().toFile(path.join(brand, "archviz-mark.png"));
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#101415" } })
  .composite([{ input: await sharp(symbol).resize(352, 352).png().toBuffer(), gravity: "centre" }])
  .png().toFile(path.join(root, "app/icon.png"));
console.log("Generated Archviz product mark and website icon.");