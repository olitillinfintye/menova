import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const videoRows = new Map();
let contentRow = null;
const sqlQueries = [];
const blobLookups = [];
const testVersion = "186d4bc7-962f-4de3-a270-e4846a126a0b";
let uploadedBlob;
let storageUnavailable = false;
globalThis.mediaTestCredentials = { version: testVersion };
globalThis.mediaTestHead = async (pathname) => {
  blobLookups.push(pathname);
  return uploadedBlob;
};
globalThis.mediaTestUpload = async ({ body, onBeforeGenerateToken }) => ({
  type: body.type,
  options: await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload),
});
globalThis.mediaTestSql = async (strings, ...values) => {
  const text = strings.join("?");
  sqlQueries.push({ text, values });
  if (storageUnavailable) throw new Error("Test storage unavailable");
  if (text.includes("INSERT INTO site_content") || text.includes("UPDATE site_content")) {
    if (text.includes("INSERT") ? contentRow !== null : !contentRow || contentRow.revision !== values[1]) {
      return { rows: [], rowCount: 0 };
    }
    contentRow = { content: JSON.parse(values[0]), revision: (contentRow?.revision ?? 0) + 1, updated_at: "2026-09-16T00:00:00.000Z" };
    return { rows: [contentRow], rowCount: 1 };
  }
  if (text.includes("FROM site_content")) return { rows: contentRow ? [contentRow] : [] };
  if (text.includes("INSERT INTO site_videos")) {
    const row = { slot: values[0], url: values[1], filename: values[2], size_bytes: values[3], updated_at: "2026-09-14T00:00:00.000Z" };
    videoRows.set(row.slot, row);
    return { rows: [row], rowCount: 1 };
  }
  if (text.includes("DELETE FROM site_videos")) {
    return { rows: [], rowCount: videoRows.delete(values[0]) ? 1 : 0 };
  }
  if (text.includes("FROM site_videos")) return { rows: [...videoRows.values()] };
  return { rows: [], rowCount: 0 };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const cookies = async () => ({ get: (name) => name === 'menova_admin' && globalThis.mediaTestCookie ? { value: globalThis.mediaTestCookie } : undefined });", shortCircuit: true };
    }
    if (specifier === "next/link" || specifier === "next/image") {
      const entry = new URL(`node_modules/${specifier}.js`, root).href;
      return { url: `data:text/javascript,${encodeURIComponent(`import next from ${JSON.stringify(entry)}; export default next.default ?? next;`)}`, shortCircuit: true };
    }
    if (/^next\/[^/.]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    if (specifier === "@/lib/admin-credentials") {
      return { url: "data:text/javascript,export const getAdminCredentials = async () => globalThis.mediaTestCredentials;", shortCircuit: true };
    }
    if (specifier === "@vercel/blob") {
      return { url: "data:text/javascript,export const head = (...args) => globalThis.mediaTestHead(...args);", shortCircuit: true };
    }
    if (specifier === "@vercel/blob/client") {
      return { url: "data:text/javascript,export const handleUpload = (...args) => globalThis.mediaTestUpload(...args);", shortCircuit: true };
    }
    if (specifier === "@vercel/postgres") {
      return { url: "data:text/javascript,export const sql = (...args) => globalThis.mediaTestSql(...args);", shortCircuit: true };
    }
    if (specifier.endsWith(".module.css")) {
      return { url: "data:text/javascript,export default new Proxy({}, {get: (_, key) => key});", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const source = new URL(specifier.slice(2) + ".ts", root);
      return { url: existsSync(source) ? source.href : new URL(specifier.slice(2) + ".tsx", root).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(
        readFileSync(new URL(url), "utf8"),
        { fileName: new URL(url).pathname, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
      ).outputText };
    }
    return nextLoad(url, context);
  },
});

const media = await import("../lib/site-media.ts");
const siteContent = await import("../lib/site-content.ts");

test("homepage content defaults preserve the current sections without sharing mutable state", () => {
  const content = siteContent.defaultHomeContent();
  assert.deepEqual(siteContent.parseHomeContent(content), content);
  assert.equal(content.hero.heading, "your next");
  assert.equal(content.hero.imageUrl, "/media/archviz-ethiopian-vr.webp");
  assert.equal(content.solutions.card5Title, "Sell before it stands");
  content.hero.heading = "Changed title";
  assert.equal(siteContent.defaultHomeContent().hero.heading, "your next");
});

test("homepage content validates text limits and rejects incomplete or unknown fields", () => {
  for (const value of [null, [], {}, { ...siteContent.defaultHomeContent(), unexpected: {} }]) {
    assert.throws(() => siteContent.parseHomeContent(value));
  }
  for (const value of ["", "   ", "a".repeat(81), null, 123, "Bad\u0000text"]) {
    const content = siteContent.defaultHomeContent();
    content.hero.heading = value;
    assert.throws(() => siteContent.parseHomeContent(content));
  }
  const content = siteContent.defaultHomeContent();
  content.hero.heading = "  A new space  ";
  assert.equal(siteContent.parseHomeContent(content).hero.heading, "A new space");
  delete content.footer.body;
  assert.throws(() => siteContent.parseHomeContent(content));
});

test("homepage content links allow site paths and HTTPS but reject executable and credential URLs", () => {
  const content = siteContent.defaultHomeContent();
  for (const href of ["/contact", "/#devices", "#workflow", "https://example.com/book?source=home"]) {
    content.hero.buttonHref = href;
    assert.equal(siteContent.parseHomeContent(content).hero.buttonHref, href);
  }
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "//evil.example", "/\\evil.example", "http://example.com", "https://user:password@example.com", "https://exa mple.com"]) {
    content.hero.buttonHref = href;
    assert.throws(() => siteContent.parseHomeContent(content));
  }
  content.hero.buttonHref = "/contact";
  content.hero.imageUrl = "#workflow";
  assert.throws(() => siteContent.parseHomeContent(content));
});

test("homepage and device videos default independently to the existing video", () => {
  const videos = media.defaultSiteVideos();
  assert.deepEqual(Object.keys(videos), ["home", "devices"]);
  assert.equal(videos.home.url, media.DEFAULT_SITE_VIDEO_URL);
  assert.equal(videos.devices.url, media.DEFAULT_SITE_VIDEO_URL);
  videos.home.url = "/changed.mp4";
  assert.equal(videos.devices.url, media.DEFAULT_SITE_VIDEO_URL);
  assert.equal(media.defaultSiteVideos().home.url, media.DEFAULT_SITE_VIDEO_URL);
});

test("site videos allow only non-empty MP4 or WebM files up to 100 MB", () => {
  assert.equal(media.validateVideoFile("Walkthrough.MP4", 100, "video/mp4"), "video/mp4");
  assert.equal(media.validateVideoFile("devices.webm", media.MAX_VIDEO_BYTES), "video/webm");
  for (const [name, size, type] of [
    ["video.svg", 10], ["video.mp4.html", 10], ["video.mp4", 10, "text/html"],
    ["video.webm", 10, "video/mp4"], ["video.mp4", 0], ["video.mp4", -1],
    ["video.mp4", 1.5], ["video.mp4", Infinity], ["video.mp4", media.MAX_VIDEO_BYTES + 1],
  ]) assert.throws(() => media.validateVideoFile(name, size, type));
});

test("video upload paths are restricted to their homepage section", () => {
  assert.deepEqual(media.parseVideoPathname("site-videos/home/12345678.mp4"), { slot: "home", contentType: "video/mp4" });
  assert.deepEqual(media.parseVideoPathname("site-videos/devices/12345678.webm"), { slot: "devices", contentType: "video/webm" });
  for (const pathname of [
    "models/12345678.mp4", "site-videos/other/12345678.mp4", "site-videos/home/../12345678.mp4",
    "site-videos/home/12345678.svg", "https://example.com/video.mp4", null,
  ]) assert.throws(() => media.parseVideoPathname(pathname));
});

const mediaDb = await import("../lib/site-media-db.ts");

test("public video settings work without a database while admin reads fail explicitly", async () => {
  delete process.env.POSTGRES_URL;
  assert.deepEqual(await mediaDb.getSiteVideos(), media.defaultSiteVideos());
  await assert.rejects(mediaDb.getSiteVideos(true), /not configured/);
  assert.equal(sqlQueries.length, 0);
});

test("video selections persist independently and resetting one preserves the other", async () => {
  process.env.POSTGRES_URL = "test-only";
  const home = { url: "https://blob.example/home.mp4", filename: "home.mp4", sizeBytes: 1234 };
  const devices = { url: "https://blob.example/devices.webm", filename: "devices.webm", sizeBytes: 5678 };
  const savedHome = await mediaDb.saveSiteVideo("home", home);
  const savedDevices = await mediaDb.saveSiteVideo("devices", devices);
  assert.deepEqual(savedHome, { ...home, updatedAt: "2026-09-14T00:00:00.000Z" });
  assert.deepEqual(await mediaDb.getSiteVideos(true), { home: savedHome, devices: savedDevices });
  await mediaDb.resetSiteVideo("home");
  assert.deepEqual(await mediaDb.getSiteVideos(true), { home: media.defaultSiteVideos().home, devices: savedDevices });
  assert.deepEqual(sqlQueries.filter(({ text }) => text.includes("DELETE FROM site_videos")).at(-1).values, ["home"]);
});

test("video read failures preserve the homepage fallback but remain visible to admins", async () => {
  storageUnavailable = true;
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);
  try {
    assert.deepEqual(await mediaDb.getSiteVideos(), media.defaultSiteVideos());
    await assert.rejects(mediaDb.getSiteVideos(true), /Test storage unavailable/);
    assert.equal(messages.length, 1);
  } finally {
    storageUnavailable = false;
    console.error = originalError;
  }
});

const adminSession = await import("../lib/admin-session.ts");
const mediaApi = await import("../app/api/admin/media/route.ts");
const { POST: uploadVideo } = await import("../app/api/admin/media/upload/route.ts");
process.env.AUTH_SECRET = "media-test-secret-only-not-for-production";
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token-not-for-production";

function mediaRequest(method, body, headers = {}, path = "") {
  return new Request(`https://archviz.example/api/admin/media${path}`, {
    method, headers: { Origin: "https://archviz.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function videoTokenBody(slot = "home", filename = "home.mp4", sizeBytes = 1234) {
  return {
    type: "blob.generate-client-token",
    payload: {
      pathname: `site-videos/${slot}/12345678.mp4`,
      clientPayload: JSON.stringify({ slot, filename, sizeBytes }),
    },
  };
}

test("video settings, uploads, saves and resets reject non-admins before storage access", async () => {
  process.env.ALLOW_ANONYMOUS = "true";
  const queryCount = sqlQueries.length;
  const lookupCount = blobLookups.length;
  for (const cookie of [undefined, "public.fake-signature", adminSession.createAdminSession(testVersion, Date.now() - 9 * 60 * 60 * 1000)]) {
    globalThis.mediaTestCookie = cookie;
    assert.equal((await mediaApi.GET()).status, 401);
    assert.equal((await mediaApi.PUT(mediaRequest("PUT", { slot: "home" }))).status, 401);
    assert.equal((await mediaApi.DELETE(mediaRequest("DELETE", { slot: "home" }))).status, 401);
    assert.equal((await uploadVideo(mediaRequest("POST", videoTokenBody(), {}, "/upload"))).status, 401);
  }
  delete globalThis.mediaTestCookie;
  assert.equal(sqlQueries.length, queryCount);
  assert.equal(blobLookups.length, lookupCount);
});

test("video mutations reject cross-site admin requests before storage access", async () => {
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  const queryCount = sqlQueries.length;
  const lookupCount = blobLookups.length;
  try {
    for (const headers of [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await mediaApi.PUT(mediaRequest("PUT", { slot: "home" }, headers))).status, 403);
      assert.equal((await mediaApi.DELETE(mediaRequest("DELETE", { slot: "home" }, headers))).status, 403);
      assert.equal((await uploadVideo(mediaRequest("POST", videoTokenBody(), headers, "/upload"))).status, 403);
    }
    assert.equal(sqlQueries.length, queryCount);
    assert.equal(blobLookups.length, lookupCount);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

test("admin upload tokens enforce video limits without publishing the upload", async () => {
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  const rowsBefore = [...videoRows.entries()];
  try {
    const response = await uploadVideo(mediaRequest("POST", videoTokenBody(), {}, "/upload"));
    assert.equal(response.status, 200);
    const { options } = await response.json();
    assert.deepEqual(options.allowedContentTypes, ["video/mp4"]);
    assert.equal(options.maximumSizeInBytes, media.MAX_VIDEO_BYTES);
    assert.equal(options.addRandomSuffix, true);
    assert.equal(options.allowOverwrite, false);
    for (const body of [videoTokenBody("other"), videoTokenBody("home", "test.html"), videoTokenBody("home", "test.mp4", media.MAX_VIDEO_BYTES + 1)]) {
      const rejected = await uploadVideo(mediaRequest("POST", body, {}, "/upload"));
      assert.ok(rejected.status >= 400 && rejected.status < 500);
    }
    assert.deepEqual([...videoRows.entries()], rowsBefore);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

test("admin video saves verify blob metadata and reset only the selected section", async () => {
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  const pathname = "site-videos/home/12345678.mp4";
  uploadedBlob = { pathname, url: "https://blob.example/new-home.mp4", size: 1234, contentType: "video/mp4" };
  const devicesBefore = videoRows.get("devices");
  try {
    const body = { slot: "home", pathname, filename: "new-home.mp4" };
    assert.equal((await mediaApi.PUT(mediaRequest("PUT", { ...body, slot: "devices" }))).status, 400);
    const response = await mediaApi.PUT(mediaRequest("PUT", body));
    assert.equal(response.status, 200);
    const { video } = await response.json();
    assert.equal(video.url, uploadedBlob.url);
    assert.equal(video.sizeBytes, uploadedBlob.size);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(videoRows.get("devices"), devicesBefore);
    for (const overrides of [{ size: media.MAX_VIDEO_BYTES + 1 }, { contentType: "text/html" }, { pathname: "models/12345678.mp4" }]) {
      const validBlob = uploadedBlob;
      uploadedBlob = { ...validBlob, ...overrides };
      const rejected = await mediaApi.PUT(mediaRequest("PUT", body));
      assert.ok(rejected.status >= 400 && rejected.status < 500);
      uploadedBlob = validBlob;
      assert.equal(videoRows.get("home").url, validBlob.url);
    }
    const settings = await mediaApi.GET();
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).videos.home.url, video.url);
    const reset = await mediaApi.DELETE(mediaRequest("DELETE", { slot: "home" }));
    assert.equal(reset.status, 200);
    assert.deepEqual((await reset.json()).video, media.defaultSiteVideos().home);
    assert.deepEqual(videoRows.get("devices"), devicesBefore);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

const contentDb = await import("../lib/site-content-db.ts");
const contentApi = await import("../app/api/admin/homepage/route.ts");
const { POST: uploadHomeImage } = await import("../app/api/admin/homepage/upload/route.ts");

test("homepage content has safe public defaults and explicit admin storage failures", async () => {
  delete process.env.POSTGRES_URL;
  const fallback = { content: siteContent.defaultHomeContent(), revision: 0, updatedAt: null };
  assert.deepEqual(await contentDb.getHomeContent(), fallback);
  await assert.rejects(contentDb.getHomeContent(true), /not configured/);
  process.env.POSTGRES_URL = "test-only";
  storageUnavailable = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await contentDb.getHomeContent(), fallback);
    await assert.rejects(contentDb.getHomeContent(true), /unavailable/);
  } finally {
    storageUnavailable = false;
    console.error = originalError;
  }
});

test("homepage content persists parameterized changes and rejects stale revisions", async () => {
  contentRow = null;
  process.env.POSTGRES_URL = "test-only";
  const content = siteContent.defaultHomeContent();
  content.hero.heading = "Clients' new home";
  const saved = await contentDb.saveHomeContent(content, 0);
  assert.equal(saved.revision, 1);
  assert.equal((await contentDb.getHomeContent(true)).content.hero.heading, content.hero.heading);
  const insert = sqlQueries.findLast(({ text }) => text.includes("INSERT INTO site_content"));
  assert.ok(!insert.text.includes(content.hero.heading));
  assert.equal(JSON.parse(insert.values[0]).hero.heading, content.hero.heading);
  await assert.rejects(contentDb.saveHomeContent(content, 0), (error) => error.status === 409);
  const changed = { ...content, devices: { ...content.devices, heading: "Every screen" } };
  const updated = await contentDb.saveHomeContent(changed, saved.revision);
  assert.equal(updated.revision, 2);
  await assert.rejects(contentDb.saveHomeContent(content, 1), (error) => error.status === 409);
  assert.equal((await contentDb.getHomeContent(true)).content.devices.heading, "Every screen");
  delete contentRow.content.hero.phoneCaption;
  assert.equal((await contentDb.getHomeContent(true)).content.hero.phoneCaption, siteContent.defaultHomeContent().hero.phoneCaption);
});

test("homepage content endpoints reject anonymous and cross-site requests before storage", async () => {
  const queryCount = sqlQueries.length;
  process.env.ALLOW_ANONYMOUS = "true";
  delete globalThis.mediaTestCookie;
  const body = { content: siteContent.defaultHomeContent(), revision: 0 };
  assert.equal((await contentApi.GET()).status, 401);
  assert.equal((await contentApi.PUT(mediaRequest("PUT", body))).status, 401);
  assert.equal((await contentApi.DELETE(mediaRequest("DELETE", body))).status, 401);
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  try {
    assert.equal((await contentApi.PUT(mediaRequest("PUT", body, { Origin: "https://other.example" }))).status, 403);
    assert.equal((await contentApi.DELETE(mediaRequest("DELETE", body, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
    assert.equal(sqlQueries.length, queryCount);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

test("homepage content API saves, reports conflicts and restores defaults without changing videos", async () => {
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  const videosBefore = [...videoRows.entries()];
  try {
    const response = await contentApi.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const state = await response.json();
    state.content.hero.heading = "Published heading";
    const saved = await contentApi.PUT(mediaRequest("PUT", state));
    assert.equal(saved.status, 200);
    const published = await saved.json();
    assert.equal(published.content.hero.heading, "Published heading");
    assert.equal((await contentApi.PUT(mediaRequest("PUT", state))).status, 409);
    for (const body of [null, {}, { ...state, revision: -1 }, { ...state, content: {} }]) {
      assert.equal((await contentApi.PUT(mediaRequest("PUT", body))).status, 400);
    }
    assert.equal((await contentApi.PUT(mediaRequest("PUT", state, { "Content-Length": "70000" }))).status, 413);
    const reset = await contentApi.DELETE(mediaRequest("DELETE", { revision: published.revision }));
    assert.equal(reset.status, 200);
    assert.deepEqual((await reset.json()).content, siteContent.defaultHomeContent());
    assert.deepEqual([...videoRows.entries()], videosBefore);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

test("homepage content image uploads require admin and restrict image types, size and path", async () => {
  const body = {
    type: "blob.generate-client-token",
    payload: { pathname: "site-images/home/12345678.webp", clientPayload: JSON.stringify({ filename: "hero.webp", sizeBytes: 1024 }) },
  };
  delete globalThis.mediaTestCookie;
  assert.equal((await uploadHomeImage(mediaRequest("POST", body))).status, 401);
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  const stateBefore = structuredClone(contentRow);
  try {
    assert.equal((await uploadHomeImage(mediaRequest("POST", body, { Origin: "https://other.example" }))).status, 403);
    const response = await uploadHomeImage(mediaRequest("POST", body));
    assert.equal(response.status, 200);
    const { options } = await response.json();
    assert.deepEqual(options.allowedContentTypes, ["image/webp"]);
    assert.equal(options.maximumSizeInBytes, 5 * 1024 * 1024);
    assert.equal(options.allowOverwrite, false);
    for (const payload of [
      { ...body.payload, pathname: "models/12345678.webp" },
      { ...body.payload, pathname: "site-images/home/../12345678.webp" },
      { ...body.payload, pathname: "site-images/home/12345678.svg" },
      { ...body.payload, clientPayload: JSON.stringify({ filename: "hero.png", sizeBytes: 1024 }) },
      { ...body.payload, clientPayload: JSON.stringify({ filename: "hero.webp", sizeBytes: 5 * 1024 * 1024 + 1 }) },
    ]) {
      const rejected = await uploadHomeImage(mediaRequest("POST", { ...body, payload }));
      assert.ok(rejected.status >= 400 && rejected.status < 500);
    }
    assert.deepEqual(contentRow, stateBefore);
  } finally {
    delete globalThis.mediaTestCookie;
  }
});

test("homepage content publishes only verified uploaded image metadata", async () => {
  const previousBlob = uploadedBlob;
  const verifiedBlob = { pathname: "site-images/home/12345678.webp", url: "https://images.example/verified.webp", contentType: "image/webp", size: 2048 };
  globalThis.mediaTestCookie = adminSession.createAdminSession(testVersion);
  try {
    const state = await contentDb.getHomeContent(true);
    state.content.hero.imageUrl = "https://unverified.example/image.webp";
    const body = { ...state, imageUpload: { pathname: verifiedBlob.pathname, filename: "hero.webp" } };
    for (const invalidBlob of [
      { ...verifiedBlob, pathname: "site-images/home/different.webp" },
      { ...verifiedBlob, contentType: "image/png" },
      { ...verifiedBlob, size: 5 * 1024 * 1024 + 1 },
      { ...verifiedBlob, size: 0 },
    ]) {
      uploadedBlob = invalidBlob;
      const response = await contentApi.PUT(mediaRequest("PUT", body));
      assert.ok(response.status >= 400 && response.status < 500);
      assert.equal((await contentDb.getHomeContent(true)).revision, state.revision);
    }
    const lookups = blobLookups.length;
    for (const imageUpload of [null, {}, { pathname: "models/12345678.webp", filename: "hero.webp" }]) {
      assert.equal((await contentApi.PUT(mediaRequest("PUT", { ...body, imageUpload }))).status, 400);
    }
    assert.equal(blobLookups.length, lookups);
    uploadedBlob = verifiedBlob;
    const response = await contentApi.PUT(mediaRequest("PUT", body));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content.hero.imageUrl, verifiedBlob.url);
    assert.equal((await contentDb.getHomeContent(true)).content.hero.imageUrl, verifiedBlob.url);
  } finally {
    uploadedBlob = previousBlob;
    delete globalThis.mediaTestCookie;
  }
});

test("homepage renders every saved content field as text or a validated destination", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: HomePage } = await import("../app/page.tsx");
  const content = siteContent.defaultHomeContent();
  for (const section of siteContent.HOME_SECTION_KEYS) {
    for (const [key, definition] of Object.entries(siteContent.HOME_CONTENT_SECTIONS[section].fields)) {
      content[section][key] = definition.kind === "link" || definition.kind === "image"
        ? `https://example.test/${section}/${key}` : `Edited ${section} ${key}`;
    }
  }
  await contentDb.saveHomeContent(content, contentRow.revision);
  const html = renderToStaticMarkup(await HomePage());
  for (const section of Object.values(content)) {
    for (const value of Object.values(section)) assert.ok(html.includes(value), `Missing published field: ${value}`);
  }
  content.hero.body = "<script>alert('text-only')</script>";
  await contentDb.saveHomeContent(content, contentRow.revision);
  const escaped = renderToStaticMarkup(await HomePage());
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(!escaped.includes(content.hero.body));
});