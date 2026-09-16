import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

const modulePath = process.argv[2] || process.env.PLAYWRIGHT_MODULE;
const origin = process.argv[3] || "http://127.0.0.1:3001";
if (!modulePath || !process.env.ADMIN_PASSWORD) throw new Error("Configure Playwright and the local admin password for the smoke test.");
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ headless: true });
const defaultUrl = "/media/3D_Interior_animation.mp4";
const errors = [];
await mkdir("artifacts/media-check", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90_000);
  page.on("pageerror", error => errors.push(error.message));
  async function waitForHydratedInput(selector) {
    await page.waitForFunction(selector => {
      const input = document.querySelector(selector);
      if (!input) return false;
      const key = Object.keys(input).find(key => key.startsWith("__reactProps$"));
      return Boolean(key && typeof input[key]?.onChange === "function");
    }, selector);
  }
  for (const [path, method, data] of [
    ["/api/admin/media", "GET"], ["/api/admin/media/upload", "POST", {}],
    ["/api/admin/homepage", "GET"], ["/api/admin/homepage", "PUT", {}],
    ["/api/admin/homepage", "DELETE", {}], ["/api/admin/homepage/upload", "POST", {}],
    ["/api/projects?id=proj_12345678", "DELETE"],
    ["/api/projects?id=proj_12345678", "PATCH", { isPublic: false }],
  ]) {
    const response = await context.request.fetch(`${origin}${path}`, { method, data, headers: { Origin: origin } });
    assert.equal(response.status(), 401);
  }
  await page.goto(`${origin}/admin/videos`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/admin/login");
  await page.goto(`${origin}/admin/homepage`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/admin/login");
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll("video")].length === 2 && [...document.querySelectorAll("video")].every(video => video.videoWidth > 0));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `artifacts/media-check/home-${width}.png`, animations: "disabled" });
  }

  const login = await context.request.post(`${origin}/api/admin/session`, { headers: { Origin: origin }, data: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(login.status(), 200, "Configured admin password must authorize the release smoke test.");
  const adminCookie = (await context.cookies()).find(cookie => cookie.name === "menova_admin");
  assert.ok(adminCookie, "Admin sign-in must issue a cookie.");
  if (origin.startsWith("http://127.0.0.1:")) await context.addCookies([{ ...adminCookie, secure: false }]);
  const settingsResponse = await context.request.get(`${origin}/api/admin/media`);
  assert.equal(settingsResponse.status(), 200, "Signed-in admin must be able to load video settings.");
  const { videos } = await settingsResponse.json();
  let uploadedPath;
  let blobUploads = 0;
  let failNextSave = true;
  await page.route("**/api/admin/media/upload", async route => {
    const { payload } = route.request().postDataJSON();
    uploadedPath = payload.pathname;
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: "vercel_blob_rw_smoketest_fake-secret", pathname: uploadedPath,
      allowedContentTypes: ["video/webm"], maximumSizeInBytes: 100 * 1024 * 1024,
      addRandomSuffix: true, allowOverwrite: false,
    });
    await route.fulfill({ json: { type: "blob.generate-client-token", clientToken } });
  });
  await page.route(url => url.hostname.endsWith("vercel-storage.com") || (url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob")), async route => {
    if (route.request().method() === "GET") return route.continue();
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "PUT, POST, OPTIONS" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    blobUploads += 1;
    await route.fulfill({ headers, json: { url: `${origin}${defaultUrl}`, pathname: uploadedPath, contentType: "video/webm", contentDisposition: "inline" } });
  });
  await page.route("**/api/admin/media", async route => {
    const method = route.request().method();
    if (method === "GET") return route.continue();
    const body = route.request().postDataJSON();
    assert.ok(["home", "devices"].includes(body.slot));
    if (method === "PUT" && failNextSave) {
      failNextSave = false;
      return route.fulfill({ status: 503, json: { error: "Test save unavailable." } });
    }
    if (method === "PUT") {
      videos[body.slot] = { url: `${defaultUrl}?smoke=${body.slot}`, filename: body.filename, sizeBytes: 1024, updatedAt: new Date().toISOString() };
    } else if (method === "DELETE") {
      videos[body.slot] = { url: defaultUrl, filename: "3D_Interior_animation.mp4", sizeBytes: null, updatedAt: null };
    } else throw new Error("Unexpected media mutation in smoke test.");
    await route.fulfill({ json: { video: videos[body.slot] } });
  });
  await page.goto(`${origin}/admin/videos`, { waitUntil: "domcontentloaded" });
  const home = page.getByRole("region", { name: "Homepage video", exact: true });
  const devices = page.getByRole("region", { name: "Devices video", exact: true });
  await home.getByRole("button", { name: "Choose video", exact: true }).waitFor();
  await waitForHydratedInput("#home-video-file");
  const originalDevicesUrl = await devices.locator("video").getAttribute("src");
  const fixture = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const drawing = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const finished = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    for (let frame = 0; frame < 12; frame += 1) {
      drawing.fillStyle = frame % 2 ? "#238a78" : "#e2a34f";
      drawing.fillRect(0, 0, 320, 180);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    recorder.stop();
    await finished;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())];
  }));
  await home.locator('input[type="file"]').setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await home.getByRole("alert").filter({ hasText: "Choose an MP4 or WebM video." }).waitFor();
  const filename = `homepage-${"preview-".repeat(12)}.webm`;
  await home.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "video/webm", buffer: fixture });
  await home.getByText("Unsaved changes", { exact: true }).waitFor();
  await home.getByRole("button", { name: "Save video", exact: true }).click();
  await home.getByRole("alert").waitFor();
  assert.equal(await home.getByRole("alert").innerText(), "Test save unavailable.");
  assert.equal(blobUploads, 1);
  await home.getByRole("button", { name: "Save video", exact: true }).click();
  await home.getByRole("status").filter({ hasText: "Homepage video saved." }).waitFor();
  assert.equal(blobUploads, 1, "Retrying a metadata save must reuse the completed upload.");
  assert.equal(await devices.locator("video").getAttribute("src"), originalDevicesUrl);
  await devices.locator('input[type="file"]').setInputFiles({ name: "devices.webm", mimeType: "video/webm", buffer: fixture });
  await devices.getByRole("button", { name: "Save video", exact: true }).click();
  await devices.getByRole("status").filter({ hasText: "Devices video saved." }).waitFor();
  assert.equal(blobUploads, 2);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
      outside: [...document.querySelectorAll("button, nav a, video")].filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
      }).map(element => element.getAttribute("aria-label") || element.textContent),
    }));
    assert.equal(layout.fits, true);
    assert.deepEqual(layout.outside, []);
    await page.screenshot({ path: `artifacts/media-check/admin-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await home.getByRole("button", { name: "Restore default", exact: true }).click();
  await home.getByRole("button", { name: "Restore", exact: true }).click();
  await home.getByRole("status").filter({ hasText: "Homepage default restored." }).waitFor();
  assert.equal(await devices.locator("video").getAttribute("src"), `${defaultUrl}?smoke=devices`);
  const persisted = await context.request.get(`${origin}/api/admin/media`);
  assert.equal((await persisted.json()).videos.devices.url, originalDevicesUrl);

  const homepageResponse = await context.request.get(`${origin}/api/admin/homepage`);
  assert.equal(homepageResponse.status(), 200);
  const originalHomepage = await homepageResponse.json();
  let publishedHomepage = structuredClone(originalHomepage);
  let failHomepageSave = true;
  let homepageImagePath;
  let homepageImageUploads = 0;
  await page.route("**/api/admin/homepage/upload", async route => {
    const { payload } = route.request().postDataJSON();
    homepageImagePath = payload.pathname;
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: "vercel_blob_rw_smoketest_fake-secret", pathname: homepageImagePath,
      allowedContentTypes: ["image/png"], maximumSizeInBytes: 5 * 1024 * 1024,
      addRandomSuffix: true, allowOverwrite: false,
    });
    await route.fulfill({ json: { type: "blob.generate-client-token", clientToken } });
  });
  await page.route(url => url.hostname.endsWith("vercel-storage.com") || (url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob")), async route => {
    if (route.request().method() === "GET") return route.continue();
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "PUT, POST, OPTIONS" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    homepageImageUploads += 1;
    await route.fulfill({ headers, json: { url: `${origin}${originalHomepage.content.hero.imageUrl}`, pathname: homepageImagePath, contentType: "image/png", contentDisposition: "inline" } });
  });
  await page.route("**/api/admin/homepage", async route => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: publishedHomepage });
    const body = route.request().postDataJSON();
    if (method === "PUT" && failHomepageSave) {
      failHomepageSave = false;
      return route.fulfill({ status: 503, json: { error: "Test homepage save unavailable." } });
    }
    if (body.revision !== publishedHomepage.revision) return route.fulfill({ status: 409, json: { error: "The homepage changed in another session." } });
    assert.ok(method === "PUT" || method === "DELETE");
    publishedHomepage = {
      content: method === "DELETE" ? structuredClone(originalHomepage.content) : body.content,
      revision: publishedHomepage.revision + 1, updatedAt: new Date().toISOString(),
    };
    if (body.imageUpload) {
      assert.equal(body.imageUpload.pathname, homepageImagePath);
      publishedHomepage.content.hero.imageUrl = `${originalHomepage.content.hero.imageUrl}?smoke=homepage`;
    }
    await route.fulfill({ json: publishedHomepage });
  });
  await page.goto(`${origin}/admin/homepage`, { waitUntil: "domcontentloaded" });
  await waitForHydratedInput("#home-hero-brand");
  const editor = page.locator("main form");
  const firstHeading = editor.getByLabel("Heading, first line", { exact: true });
  const saveHomepage = editor.getByRole("button", { name: "Save homepage", exact: true });
  await firstHeading.fill("A home you can explore");
  await editor.getByRole("tab", { name: "Devices", exact: true }).click();
  await editor.getByLabel("Heading", { exact: true }).fill("Everywhere you work");
  await editor.getByRole("tab", { name: "Hero", exact: false }).click();
  assert.equal(await firstHeading.inputValue(), "A home you can explore");
  await saveHomepage.click();
  await editor.getByRole("alert").filter({ hasText: "Test homepage save unavailable." }).waitFor();
  assert.equal(await firstHeading.inputValue(), "A home you can explore");
  await saveHomepage.click();
  await editor.getByRole("status").filter({ hasText: "Homepage saved." }).waitFor();
  assert.equal(publishedHomepage.content.devices.heading, "Everywhere you work");
  await firstHeading.fill("Discard this draft");
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  assert.equal(await firstHeading.inputValue(), "A home you can explore");
  await editor.getByLabel("Button link", { exact: true }).fill("javascript:alert(1)");
  await editor.getByRole("tab", { name: "Devices", exact: false }).click();
  await saveHomepage.click();
  await editor.getByRole("alert").filter({ hasText: "must be a site path" }).waitFor();
  assert.equal(await editor.getByLabel("Button link", { exact: true }).getAttribute("aria-invalid"), "true");
  await editor.getByLabel("Button link", { exact: true }).fill("/contact");
  await saveHomepage.click();
  await editor.getByRole("status").filter({ hasText: "Homepage saved." }).waitFor();
  await firstHeading.fill("Keep this draft");
  publishedHomepage = { ...publishedHomepage, revision: publishedHomepage.revision + 1,
    content: { ...publishedHomepage.content, hero: { ...publishedHomepage.content.hero, heading: "Concurrent edit" } } };
  await saveHomepage.click();
  await editor.getByRole("alert").filter({ hasText: "another session" }).waitFor();
  assert.equal(await firstHeading.inputValue(), "Keep this draft");
  await editor.getByRole("button", { name: "Reload latest content", exact: true }).click();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await firstHeading.inputValue(), "Keep this draft");
  await editor.getByRole("button", { name: "Reload latest content", exact: true }).click();
  await editor.getByRole("button", { name: "Reload content", exact: true }).click();
  await editor.getByRole("status").filter({ hasText: "Latest content loaded." }).waitFor();
  assert.equal(await firstHeading.inputValue(), "Concurrent edit");
  const imageInput = editor.getByLabel("Choose homepage image", { exact: true });
  await imageInput.setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("invalid") });
  await editor.getByRole("alert").filter({ hasText: "Choose a JPG, PNG, or WebP image." }).waitFor();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "#238a78";
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await imageInput.setInputFiles({ name: "homepage.png", mimeType: "image/png", buffer: Buffer.from(imageData, "base64") });
  assert.ok((await editor.getByAltText("Homepage background preview").getAttribute("src")).startsWith("blob:"));
  failHomepageSave = true;
  await saveHomepage.click();
  await editor.getByRole("alert").filter({ hasText: "Test homepage save unavailable." }).waitFor();
  assert.equal(homepageImageUploads, 1);
  await saveHomepage.click();
  await editor.getByRole("status").filter({ hasText: "Homepage saved." }).waitFor();
  assert.equal(homepageImageUploads, 1, "Retrying a homepage save must reuse the staged image upload.");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["Hero", "Devices", "Solutions", "Workflow", "Formats", "Call to Action", "Footer"]) {
      await editor.getByRole("tab", { name, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} must fit at ${width}px`);
    }
    await editor.getByRole("tab", { name: "Hero", exact: true }).click();
    await page.screenshot({ path: `artifacts/media-check/homepage-editor-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await editor.getByRole("button", { name: "Restore defaults", exact: true }).click();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await firstHeading.inputValue(), "Concurrent edit");
  await editor.getByRole("button", { name: "Restore defaults", exact: true }).click();
  await editor.getByRole("button", { name: "Restore homepage", exact: true }).click();
  await editor.getByRole("status").filter({ hasText: "Default homepage restored." }).waitFor();
  assert.equal(await firstHeading.inputValue(), originalHomepage.content.hero.heading);
  const homepageAfter = await context.request.get(`${origin}/api/admin/homepage`);
  assert.deepEqual(await homepageAfter.json(), originalHomepage, "Browser smoke tests must not publish real homepage edits.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, publicAccessDenied: true, videosLoaded: true, independentSaves: true, saveRetry: true, defaultReset: true, homepageSaveAndConflict: true, homepageImageRetry: true, homepageDefaults: true, realMediaUnchanged: true, realHomepageUnchanged: true, widths: [1440, 390, 320], runtimeErrors: errors }));
} catch (error) {
  throw new Error(`${String(error?.message || error)}\nRuntime errors: ${JSON.stringify(errors)}`.replaceAll(process.env.ADMIN_PASSWORD, "[redacted]"));
} finally {
  await browser.close();
}