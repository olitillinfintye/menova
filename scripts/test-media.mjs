import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const videoRows = new Map();
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
    if (specifier.startsWith("@/")) {
      return { url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(
        readFileSync(new URL(url), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      ).outputText };
    }
    return nextLoad(url, context);
  },
});

const media = await import("../lib/site-media.ts");

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