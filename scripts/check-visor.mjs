import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true });
await mkdir("artifacts/xr-check", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.VIEWER_ORIGIN || "http://localhost:3000");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download APK", exact: true }).click();
    const download = await downloadEvent;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), "archviz.apk");
    const downloadedBytes = await readFile(await download.path());
    const builtBytes = await readFile("artifacts/archviz-debug.apk");
    assert.equal(createHash("sha256").update(downloadedBytes).digest("hex"), createHash("sha256").update(builtBytes).digest("hex"));
    const previewCredit = page.locator('[data-device-preview="browser"] .archviz-lockup').locator("..");
    assert.equal(((await previewCredit.innerText()).match(/Powered by/g) || []).length, 1);
    await page.getByRole("tab", { name: "Headset", exact: true }).click();
    const preview = page.locator('[data-device-preview="headset"]');
    await preview.scrollIntoViewIfNeeded();
    await preview.locator("video").evaluate(async (video) => { await video.play(); });
    await page.waitForFunction(() => document.querySelector('[data-device-preview="headset"] video')?.currentTime > 2);
    const pixels = await preview.locator("video").evaluate((video) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      context.drawImage(video, 0, 0, 64, 32);
      const bytes = context.getImageData(0, 0, 64, 32).data;
      const colors = new Set();
      for (let index = 0; index < bytes.length; index += 4) colors.add(`${bytes[index]},${bytes[index + 1]},${bytes[index + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 20, "Visor video must show architectural content");
    assert.match(await preview.evaluate((element) => getComputedStyle(element).clipPath), /url/);
    await page.screenshot({ path: `artifacts/xr-check/visor-${width}.png`, animations: "disabled" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const device of ["Tablet", "Browser", "Mobile", "Headset"]) {
      await page.getByRole("tab", { name: device, exact: true }).click();
      assert.equal(await page.getByRole("tab", { name: device, exact: true }).getAttribute("aria-selected"), "true");
    }
    await page.getByRole("link", { name: "Open Archviz", exact: true }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    const homeLink = page.getByRole("link", { name: "Back to home", exact: true });
    assert.equal(await homeLink.isVisible(), true);
    await homeLink.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/xr-check/home-navigation-${width}.png`, animations: "disabled" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await homeLink.click();
    await page.getByRole("heading", { name: "Archviz", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, videoColors: pixels, errors }));
    await page.close();
  }
} finally {
  await browser.close();
}