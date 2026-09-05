// One-off: derives transparent brand assets from the supplied white-background logo.
// Run: node scripts/build-brand-assets.mjs path/to/source-logo.png
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC = process.argv[2];
if (!SRC) {
  console.error("Usage: node scripts/build-brand-assets.mjs <source.png>");
  process.exit(1);
}
const OUT = "public/brand";
const GOLD = [201, 150, 42];
const BLACK = [16, 16, 24];
const WHITE = [244, 243, 251];

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
// The export has a gray fringe on its right/bottom edges; treat that margin as background.
const EDGE = 4;
const inFrame = (x, y) => x >= EDGE && y >= EDGE && x < width - EDGE && y < height - EDGE;

/** White-to-alpha, then snap colour to a two-tone palette. */
function recolour(darkText) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const alpha = inFrame(x, y) ? 255 - Math.min(r, g, b) : 0;
    const gold = r - b > 40;
    const [cr, cg, cb] = gold ? GOLD : darkText ? BLACK : WHITE;
    out[i * 4] = cr;
    out[i * 4 + 1] = cg;
    out[i * 4 + 2] = cb;
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/** Bounding box of pixels with alpha above a threshold, optionally restricted to a row range. */
function bounds(buf, y0 = 0, y1 = height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Finds the widest fully-transparent horizontal band: the gap between mark and wordmark. */
function splitRow(buf) {
  const filled = new Array(height).fill(false);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 24) {
        filled[y] = true;
        break;
      }
    }
  }
  const first = filled.indexOf(true);
  const last = filled.lastIndexOf(true);
  let best = { start: 0, len: 0 };
  let run = 0;
  for (let y = first; y <= last; y += 1) {
    if (!filled[y]) {
      run += 1;
      if (run > best.len) best = { start: y - run + 1, len: run };
    } else {
      run = 0;
    }
  }
  return best.start + Math.floor(best.len / 2);
}

await mkdir(OUT, { recursive: true });

const light = recolour(true);
const dark = recolour(false);
const lockup = bounds(light);
const pad = Math.round(lockup.height * 0.04);
const lockupBox = {
  left: Math.max(0, lockup.left - pad),
  top: Math.max(0, lockup.top - pad),
  width: Math.min(width - lockup.left + pad, lockup.width + pad * 2),
  height: Math.min(height - lockup.top + pad, lockup.height + pad * 2),
};

const raw = (buf) => sharp(buf, { raw: { width, height, channels: 4 } });

await raw(light).extract(lockupBox).png().toFile(`${OUT}/menova-lockup-light.png`);
await raw(dark).extract(lockupBox).png().toFile(`${OUT}/menova-lockup-dark.png`);

const split = splitRow(light);
const mark = bounds(light, 0, split);
const markPad = Math.round(mark.height * 0.06);
const markBox = {
  left: Math.max(0, mark.left - markPad),
  top: Math.max(0, mark.top - markPad),
  width: mark.width + markPad * 2,
  height: mark.height + markPad * 2,
};
await raw(light).extract(markBox).png().toFile(`${OUT}/menova-mark.png`);

// Square favicon: mark centred on a navy tile with rounded corners.
const size = 512;
const markSquare = await raw(light)
  .extract(markBox)
  .resize({ width: Math.round(size * 0.72), height: Math.round(size * 0.72), fit: "inside" })
  .png()
  .toBuffer();
const rounded = Buffer.from(
  `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#16163a"/></svg>`,
);
await sharp(rounded)
  .composite([{ input: markSquare, gravity: "centre" }])
  .png()
  .toFile("app/icon.png");

console.log({ lockup: lockupBox, mark: markBox, split });
