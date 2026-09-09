import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs file.");
const { chromium } = await import(pathToFileURL(modulePath).href);
const origin = process.env.VIEWER_ORIGIN || "http://localhost:3000";
await mkdir("artifacts/xr-check", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const discovery = await browser.newPage();
  await discovery.goto(`${origin}/dashboard`);
  await discovery.waitForLoadState("networkidle");
  const links = await discovery.locator("a").evaluateAll((anchors) => anchors
    .map((anchor) => anchor.getAttribute("href"))
    .filter((href) => href?.startsWith("/viewer/")));
  const route = process.env.VIEWER_PATH || links[0];
  if (!route) {
    console.log((await discovery.locator("body").innerText()).slice(-1400));
    throw new Error("No existing model is available for viewer verification.");
  }
  console.log(`Testing ${origin}${route}`);
  await discovery.close();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500 });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "xr", { configurable: true, value: {
        isSessionSupported: async () => true,
        requestSession: async () => { throw new Error("Headset required"); },
        addEventListener() {}, removeEventListener() {},
      } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [path, name] of [["/", "home"], ["/dashboard", "workspace"]]) {
      await page.goto(`${origin}${path}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByText("Powered by Menova Studio", { exact: true }).first().waitFor();
      assert.match(await page.title(), /Archviz/);
      if (path === "/") {
        await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
        await page.locator("video").first().evaluate(async (video) => { await video.play(); });
        await page.waitForFunction(() => document.querySelector("video")?.currentTime > 2);
        assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "Archviz");
      }
      await page.screenshot({ path: `artifacts/xr-check/${name}-${viewport.width}.png`, animations: "disabled" });
      const overflow = await page.evaluate(() => {
        if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
        return [...document.querySelectorAll("main *, nav *")].filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && bounds.right > innerWidth + 1;
        }).slice(0, 8).map((element) => ({ tag: element.tagName, text: element.textContent?.slice(0, 70), class: element.className }));
      });
      assert.deepEqual(overflow, [], `${name} overflows viewport`);
    }
    await page.goto(`${origin}${route}`);
    try {
      await page.getByRole("button", { name: "Dollhouse", exact: true }).waitFor({ timeout: 120000 });
    } catch (error) {
      console.error(await page.locator("body").innerText(), errors);
      throw error;
    }
    await page.getByRole("button", { name: "Mixed Reality", exact: false }).waitFor();
    const canvas = page.locator("canvas[data-menova-viewer]");
    const samplePixels = () => canvas.evaluate((element) => {
      const context = element.getContext("webgl2");
      if (!context) throw new Error("No WebGL2 context");
      const bytes = new Uint8Array(element.width * element.height * 4);
      context.readPixels(0, 0, element.width, element.height, context.RGBA, context.UNSIGNED_BYTE, bytes);
      const colors = new Set();
      let checksum = 0;
      for (let index = 0; index < bytes.length; index += 128) {
        const color = bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];
        colors.add(color);
        checksum = (checksum + color) % 2147483647;
      }
      return { colors: colors.size, checksum, width: element.width, height: element.height };
    });
    const before = await samplePixels();
    assert.ok(before.colors > 20, `Canvas is blank: ${JSON.stringify(before)}`);
    await page.screenshot({ path: `artifacts/xr-check/viewer-${viewport.width}.png` });
    const controlsOutsideViewport = await page.locator("button:visible").evaluateAll((buttons) => buttons
      .filter((button) => {
        const bounds = button.getBoundingClientRect();
        for (let parent = button.parentElement; parent; parent = parent.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
            const frame = parent.getBoundingClientRect();
            if (frame.left >= 0 && frame.right <= innerWidth && frame.top >= 0 && frame.bottom <= innerHeight) return false;
          }
        }
        return bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < -1 || bounds.bottom > innerHeight + 1;
      }).map((button) => button.textContent));
    assert.deepEqual(controlsOutsideViewport, [], "Controls must fit the viewport");
    await page.getByRole("button", { name: "Dollhouse", exact: true }).click();
    await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await samplePixels();
    assert.notEqual(after.checksum, before.checksum, "Model mode control must change the rendered scene");
    assert.deepEqual(errors, [], "Viewer must not throw runtime errors");
    console.log(JSON.stringify({ viewport, pixels: before, changed: after.checksum !== before.checksum, errors }));
    await context.close();
  }
} finally {
  await browser.close();
}