import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

const modulePath = process.argv[2] || process.env.PLAYWRIGHT_MODULE;
const origin = process.argv[3] || "http://127.0.0.1:3001";
if (!modulePath || !process.env.ADMIN_PASSWORD) throw new Error("Configure Playwright and the admin password for the smoke test.");
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ headless: true });
const image = await readFile(new URL("../public/brand/archviz-mark.png", import.meta.url));
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
await mkdir("artifacts/library-check", { recursive: true });

async function checkLayout(page, name) {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
      outside: [...document.querySelectorAll("button, nav a, article, article img")].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      }).map(element => element.getAttribute("aria-label") || element.textContent),
    }));
    assert.equal(bounds.fits, true, `${name} overflows at ${width}px.`);
    assert.deepEqual(bounds.outside, [], `${name} controls must fit at ${width}px.`);
    await page.screenshot({ path: `artifacts/library-check/${name}-${width}.png`, fullPage: name !== "home", animations: "disabled" });
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [path, method, data] of [
    ["/api/upload", "GET"], ["/api/upload", "POST", { type: "blob.generate-client-token", payload: {} }],
    ["/api/projects", "POST", {}], ["/api/admin/thumbnails/upload", "POST", {}],
    ["/api/admin/thumbnails", "PUT", {}], ["/api/admin/thumbnails", "DELETE", {}],
  ]) {
    const response = await context.request.fetch(`${origin}${path}`, { method, data, headers: { Origin: origin } });
    assert.equal(response.status(), 401, `${method} ${path} must require admin.`);
  }
  const publicResponse = await context.request.get(`${origin}/api/projects?public=1`);
  assert.equal(publicResponse.status(), 200);
  assert.ok((await publicResponse.json()).projects.every(project => project.isPublic && "thumbnailUrl" in project));
  await page.goto(origin);
  await page.waitForFunction(() => [...document.querySelectorAll("video")].length === 2 && [...document.querySelectorAll("video")].every(video => video.videoWidth > 0));
  await page.waitForFunction(() => document.querySelector("[data-home-hero] img")?.naturalWidth > 0);
  assert.equal(await page.getByRole("link", { name: /workspace|new project/i }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Open Archviz", exact: true }).getAttribute("href"), "/dashboard");
  await checkLayout(page, "home");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("[data-home-ar-phone]").evaluate(element => getComputedStyle(element).animationName), "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const base = { title: "Riverside residence", blobUrl: "https://models.example/model.glb", blobPathname: "models/model.glb", sizeBytes: 2048, createdAt: "2026-09-14T00:00:00.000Z", ownerId: "public", hotspots: [], isPublic: true, thumbnailUrl: null };
  let projects = [
    { ...base, id: "proj_12345678", thumbnailUrl: "https://thumbnail-smoke.test/original.png" },
    { ...base, id: "proj_87654321", title: "Courtyard home with a long presentation title for desktop and mobile library layouts" },
    { ...base, id: "proj_aaaaaaaa", title: "Private model", isPublic: false },
  ];
  await page.route("https://thumbnail-smoke.test/**", route => route.fulfill({ contentType: "image/png", body: image }));
  await page.route("**/api/projects**", async route => {
    assert.equal(route.request().method(), "GET", "Smoke tests must not mutate real model files.");
    const publicOnly = new URL(route.request().url()).searchParams.get("public") === "1";
    await route.fulfill({ json: { projects: publicOnly ? projects.filter(project => project.isPublic) : projects } });
  });
  await page.getByRole("link", { name: "Open Archviz", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.locator("article").first().waitFor();
  assert.equal(await page.locator("article").count(), 2);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: /thumbnail|delete|browse files/i }).count(), 0);
  assert.equal(await page.getByRole("switch").count(), 0);
  assert.equal(await page.getByRole("link", { name: /hotspots|new project|workspace/i }).count(), 0);
  await page.waitForFunction(() => document.querySelector("article a img")?.naturalWidth > 0);
  assert.equal(await page.locator("article").nth(1).locator("a img").count(), 0);
  await checkLayout(page, "library");
  await page.goto(`${origin}/admin/models`);
  await page.waitForURL("**/admin/login");

  const login = await context.request.post(`${origin}/api/admin/session`, { headers: { Origin: origin }, data: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(login.status(), 200, "Configured admin password must authorize the release smoke test.");
  const cookie = (await context.cookies()).find(entry => entry.name === "menova_admin");
  assert.ok(cookie);
  if (origin.startsWith("http://127.0.0.1:")) await context.addCookies([{ ...cookie, secure: false }]);
  const realProjects = await context.request.get(`${origin}/api/projects`);
  assert.equal(realProjects.status(), 200);
  const before = fingerprint(await realProjects.json());
  let uploadedPath;
  let blobUploads = 0;
  let failNextSave = true;
  await page.route("**/api/admin/thumbnails/upload", async route => {
    const { payload } = route.request().postDataJSON();
    uploadedPath = payload.pathname;
    assert.ok(uploadedPath.startsWith("project-thumbnails/proj_12345678/"));
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: "vercel_blob_rw_smoketest_fake-secret", pathname: uploadedPath,
      allowedContentTypes: ["image/png"], maximumSizeInBytes: 5 * 1024 * 1024,
      addRandomSuffix: true, allowOverwrite: false,
    });
    await route.fulfill({ json: { type: "blob.generate-client-token", clientToken } });
  });
  await page.route(url => url.hostname.endsWith("vercel-storage.com") || (url.hostname === "vercel.com" && url.pathname.startsWith("/api/blob")), async route => {
    if (route.request().method() === "GET") return route.continue();
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "PUT, POST, OPTIONS" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    blobUploads += 1;
    await route.fulfill({ headers, json: { url: "https://thumbnail-smoke.test/updated.png", pathname: uploadedPath, contentType: "image/png", contentDisposition: "inline" } });
  });
  await page.route("**/api/admin/thumbnails", async route => {
    const body = route.request().postDataJSON();
    const method = route.request().method();
    assert.equal(body.id, "proj_12345678");
    assert.ok(["PUT", "DELETE"].includes(method));
    if (method === "PUT" && failNextSave) {
      failNextSave = false;
      return route.fulfill({ status: 503, json: { error: "Test thumbnail save unavailable." } });
    }
    if (method === "PUT") assert.equal(body.pathname, uploadedPath);
    projects = projects.map(project => project.id === body.id ? { ...project, thumbnailUrl: method === "PUT" ? "https://thumbnail-smoke.test/updated.png" : null } : project);
    await route.fulfill({ json: { project: projects.find(project => project.id === body.id) } });
  });
  await page.goto(`${origin}/admin/models`);
  await page.getByRole("button", { name: "Browse files", exact: true }).waitFor();
  await page.locator("article").first().waitFor();
  assert.equal(await page.locator("article").count(), 3);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Riverside residence", exact: true }) });
  const fileInput = card.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("invalid") });
  await card.getByRole("alert").filter({ hasText: "Choose a JPG, PNG, or WebP image." }).waitFor();
  await fileInput.setInputFiles({ name: `Exterior-${"preview-".repeat(12)}.PNG`, mimeType: "image/png", buffer: image });
  await card.getByRole("img", { name: "Riverside residence thumbnail preview", exact: true }).waitFor();
  await card.getByRole("button", { name: "Save thumbnail for Riverside residence", exact: true }).click();
  await card.getByRole("alert").filter({ hasText: "Test thumbnail save unavailable." }).waitFor();
  assert.equal(blobUploads, 1);
  await checkLayout(page, "admin-thumbnail-draft");
  await card.getByRole("button", { name: "Save thumbnail for Riverside residence", exact: true }).click();
  await card.getByRole("status").filter({ hasText: "Thumbnail saved." }).waitFor();
  assert.equal(blobUploads, 1, "Saving again must reuse the completed image upload.");
  assert.equal(await card.locator("a img").getAttribute("src"), "https://thumbnail-smoke.test/updated.png");
  assert.equal(projects[1].thumbnailUrl, null);
  await card.getByRole("button", { name: "Remove thumbnail for Riverside residence", exact: true }).click();
  const removal = card.getByRole("group", { name: "Remove thumbnail for Riverside residence", exact: true });
  await removal.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await card.locator("a img").count(), 1);
  await card.getByRole("button", { name: "Remove thumbnail for Riverside residence", exact: true }).click();
  await removal.getByRole("button", { name: "Remove", exact: true }).click();
  await card.getByRole("status").filter({ hasText: "Thumbnail removed." }).waitFor();
  assert.equal(await card.locator("a img").count(), 0);
  assert.equal(projects.length, 3);
  await checkLayout(page, "admin-models");
  await page.goto(`${origin}/dashboard`);
  await page.locator("article").first().waitFor();
  assert.equal(await page.locator("article").count(), 2, "Admins browsing the public library must not see hidden projects.");
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  const persisted = await context.request.get(`${origin}/api/projects`);
  assert.equal(fingerprint(await persisted.json()), before, "Smoke tests must leave stored models unchanged.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, publicLibraryOnly: true, adminUploadRequired: true, thumbnailPreview: true, saveRetry: true, thumbnailRemoval: true, realProjectsUnchanged: true, widths: [1440, 390, 320], runtimeErrors: errors }));
} catch (error) {
  throw new Error(String(error?.message || error).replaceAll(process.env.ADMIN_PASSWORD, "[redacted]"));
} finally {
  await browser.close();
}