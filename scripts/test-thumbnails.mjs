import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const projectId = "proj_12345678";
const otherId = "proj_87654321";
const projectRows = new Map();
const sqlQueries = [];
const blobLookups = [];
const credentialVersion = "186d4bc7-962f-4de3-a270-e4846a126a0b";
let uploadedBlob;
globalThis.thumbnailTestCredentials = { version: credentialVersion };
globalThis.thumbnailTestHead = async (pathname) => {
  blobLookups.push(pathname);
  return uploadedBlob;
};
globalThis.thumbnailTestUpload = async ({ body, onBeforeGenerateToken }) => ({
  type: body.type,
  options: await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload),
});
globalThis.thumbnailTestSql = async (strings, ...values) => {
  const text = strings.join("?");
  sqlQueries.push({ text, values });
  if (text.includes("SET thumbnail_url")) {
    const row = projectRows.get(values[1]);
    if (!row || row.owner_id !== values[2]) return { rows: [], rowCount: 0 };
    row.thumbnail_url = values[0];
    return { rows: [{ ...row }], rowCount: 1 };
  }
  if (text.includes("FROM projects") && text.includes("WHERE id =")) {
    const row = projectRows.get(values[0]);
    return { rows: row && (row.is_public || values[1]) ? [{ ...row }] : [] };
  }
  if (text.includes("FROM projects")) {
    return { rows: [...projectRows.values()].filter(row => row.owner_id === values[0] && (row.is_public || values[1])) };
  }
  return { rows: [], rowCount: 0 };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const cookies = async () => ({ get: (name) => name === 'menova_admin' && globalThis.thumbnailTestCookie ? { value: globalThis.thumbnailTestCookie } : undefined });", shortCircuit: true };
    }
    if (specifier === "@/lib/admin-credentials") {
      return { url: "data:text/javascript,export const getAdminCredentials = async () => globalThis.thumbnailTestCredentials;", shortCircuit: true };
    }
    if (specifier === "@vercel/blob") {
      return { url: "data:text/javascript,export const head = (...args) => globalThis.thumbnailTestHead(...args);", shortCircuit: true };
    }
    if (specifier === "@vercel/blob/client") {
      return { url: "data:text/javascript,export const handleUpload = (...args) => globalThis.thumbnailTestUpload(...args);", shortCircuit: true };
    }
    if (specifier === "@vercel/postgres") {
      return { url: "data:text/javascript,export const sql = (...args) => globalThis.thumbnailTestSql(...args);", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return { url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText };
    }
    return nextLoad(url, context);
  },
});

const thumbnails = await import("../lib/project-thumbnails.ts");
const database = await import("../lib/db.ts");
process.env.POSTGRES_URL = "test-only";

test("thumbnails accept only non-empty JPG, PNG and WebP files up to 5 MB", () => {
  assert.equal(thumbnails.validateThumbnailFile("Exterior.JPG", 1234, "image/jpeg"), "image/jpeg");
  assert.equal(thumbnails.validateThumbnailFile("Interior.jpeg", 1234), "image/jpeg");
  assert.equal(thumbnails.validateThumbnailFile("Plan.png", 1234), "image/png");
  assert.equal(thumbnails.validateThumbnailFile("Model.webp", thumbnails.MAX_THUMBNAIL_BYTES), "image/webp");
  for (const [name, size, type] of [
    ["image.svg", 1], ["image.jpg.html", 1], ["image.gif", 1], ["image.png", 1, "image/jpeg"],
    ["image.jpg", 0], ["image.jpg", -1], ["image.png", 1.5], ["image.webp", Infinity],
    ["image.png", thumbnails.MAX_THUMBNAIL_BYTES + 1], [null, 1],
  ]) assert.throws(() => thumbnails.validateThumbnailFile(name, size, type));
});

test("thumbnail storage paths are bound to a valid project ID", () => {
  assert.deepEqual(thumbnails.parseThumbnailPathname(`project-thumbnails/${projectId}/12345678.png`), { projectId, contentType: "image/png" });
  for (const path of [null, "https://other.example/image.jpg", "models/image.jpg", `project-thumbnails/${projectId}/../image.jpg`, "project-thumbnails/invalid/12345678.png", `project-thumbnails/${projectId}/12345678.svg`]) {
    assert.throws(() => thumbnails.parseThumbnailPathname(path));
  }
});

function resetProjects() {
  projectRows.clear();
  for (const id of [projectId, otherId]) projectRows.set(id, {
    id, title: "Test model", blob_url: "https://blob.example/model.glb", blob_pathname: "model.glb", size_bytes: 1234,
    created_at: "2026-09-14T00:00:00.000Z", owner_id: "public", upload_ref: id, hotspots: [], is_public: true,
  });
}

test("existing projects retain fallback covers and thumbnails persist for only the selected model", async () => {
  resetProjects();
  assert.equal((await database.getProject(projectId)).thumbnailUrl, null);
  const saved = await database.updateProjectThumbnail(projectId, "public", "https://blob.example/thumbnail.png");
  assert.equal(saved.thumbnailUrl, "https://blob.example/thumbnail.png");
  const projects = await database.listProjects("public");
  assert.equal(projects.find(project => project.id === projectId).thumbnailUrl, saved.thumbnailUrl);
  assert.equal(projects.find(project => project.id === otherId).thumbnailUrl, null);
  assert.deepEqual(saved.hotspots, []);
  assert.equal(saved.isPublic, true);
  await assert.rejects(database.updateProjectThumbnail(projectId, "other-owner", null), { code: "not_found" });
  const restored = await database.updateProjectThumbnail(projectId, "public", null);
  assert.equal(restored.thumbnailUrl, null);
  assert.ok(sqlQueries.some(({ text }) => text.includes("ADD COLUMN IF NOT EXISTS thumbnail_url TEXT")));
});

const session = await import("../lib/admin-session.ts");
const thumbnailApi = await import("../app/api/admin/thumbnails/route.ts");
const { POST: uploadThumbnail } = await import("../app/api/admin/thumbnails/upload/route.ts");
process.env.AUTH_SECRET = "thumbnail-test-secret-not-for-production";
process.env.BLOB_READ_WRITE_TOKEN = "thumbnail-test-token-not-for-production";

function request(method, body, headers = {}, path = "") {
  return new Request(`https://archviz.example/api/admin/thumbnails${path}`, {
    method, headers: { Origin: "https://archviz.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function tokenBody(id = projectId, filename = "model.png", sizeBytes = 1234) {
  return {
    type: "blob.generate-client-token",
    payload: { pathname: `project-thumbnails/${id}/12345678.png`, clientPayload: JSON.stringify({ projectId: id, filename, sizeBytes }) },
  };
}

test("thumbnail operations reject anonymous, bearer and expired admin sessions before storage", async () => {
  process.env.ALLOW_ANONYMOUS = "true";
  process.env.MENOVA_API_TOKEN = "thumbnail-test-api-token";
  const queryCount = sqlQueries.length;
  const lookupCount = blobLookups.length;
  for (const cookie of [undefined, "public.fake", session.createAdminSession(credentialVersion, Date.now() - 9 * 60 * 60 * 1000)]) {
    globalThis.thumbnailTestCookie = cookie;
    const headers = { Authorization: "Bearer thumbnail-test-api-token" };
    assert.equal((await uploadThumbnail(request("POST", tokenBody(), headers, "/upload"))).status, 401);
    assert.equal((await thumbnailApi.PUT(request("PUT", { id: projectId }, headers))).status, 401);
    assert.equal((await thumbnailApi.DELETE(request("DELETE", { id: projectId }, headers))).status, 401);
  }
  delete globalThis.thumbnailTestCookie;
  assert.equal(sqlQueries.length, queryCount);
  assert.equal(blobLookups.length, lookupCount);
});

test("thumbnail mutations reject cross-site admin requests before storage", async () => {
  globalThis.thumbnailTestCookie = session.createAdminSession(credentialVersion);
  const queryCount = sqlQueries.length;
  const lookupCount = blobLookups.length;
  try {
    for (const headers of [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await uploadThumbnail(request("POST", tokenBody(), headers, "/upload"))).status, 403);
      assert.equal((await thumbnailApi.PUT(request("PUT", { id: projectId }, headers))).status, 403);
      assert.equal((await thumbnailApi.DELETE(request("DELETE", { id: projectId }, headers))).status, 403);
    }
    assert.equal(sqlQueries.length, queryCount);
    assert.equal(blobLookups.length, lookupCount);
  } finally {
    delete globalThis.thumbnailTestCookie;
  }
});

test("thumbnail tokens enforce project ownership, image types and the 5 MB limit", async () => {
  resetProjects();
  projectRows.get(projectId).is_public = false;
  projectRows.get(otherId).owner_id = "other-owner";
  globalThis.thumbnailTestCookie = session.createAdminSession(credentialVersion);
  try {
    const response = await uploadThumbnail(request("POST", tokenBody(), {}, "/upload"));
    assert.equal(response.status, 200);
    const { options } = await response.json();
    assert.deepEqual(options.allowedContentTypes, ["image/png"]);
    assert.equal(options.maximumSizeInBytes, thumbnails.MAX_THUMBNAIL_BYTES);
    assert.equal(options.allowOverwrite, false);
    assert.equal(options.addRandomSuffix, true);
    for (const body of [tokenBody(projectId, "invalid.svg"), tokenBody(projectId, "model.png", thumbnails.MAX_THUMBNAIL_BYTES + 1)]) {
      const rejected = await uploadThumbnail(request("POST", body, {}, "/upload"));
      assert.ok(rejected.status >= 400 && rejected.status < 500);
    }
    for (const id of [otherId, "proj_aaaaaaaa"]) assert.equal((await uploadThumbnail(request("POST", tokenBody(id), {}, "/upload"))).status, 404);
    assert.equal(projectRows.get(projectId).thumbnail_url, undefined);
  } finally {
    delete globalThis.thumbnailTestCookie;
  }
});

test("admin saves validate the uploaded thumbnail and removing it preserves the model", async () => {
  resetProjects();
  projectRows.get(projectId).is_public = false;
  globalThis.thumbnailTestCookie = session.createAdminSession(credentialVersion);
  const pathname = `project-thumbnails/${projectId}/12345678.png`;
  uploadedBlob = { pathname, url: "https://blob.example/verified.png", size: 1234, contentType: "image/png" };
  const body = { id: projectId, pathname, filename: "model.png" };
  try {
    assert.equal((await thumbnailApi.PUT(request("PUT", { ...body, id: otherId }))).status, 400);
    const response = await thumbnailApi.PUT(request("PUT", body));
    assert.equal(response.status, 200);
    const { project } = await response.json();
    assert.equal(project.thumbnailUrl, uploadedBlob.url);
    assert.equal(project.isPublic, false);
    assert.equal((await database.getProject(projectId)), null);
    assert.equal((await database.getProject(otherId)).thumbnailUrl, null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    for (const overrides of [{ size: thumbnails.MAX_THUMBNAIL_BYTES + 1 }, { contentType: "image/svg+xml" }, { pathname: `project-thumbnails/${otherId}/12345678.png` }]) {
      const validBlob = uploadedBlob;
      uploadedBlob = { ...validBlob, ...overrides };
      const rejected = await thumbnailApi.PUT(request("PUT", body));
      assert.ok(rejected.status >= 400 && rejected.status < 500);
      uploadedBlob = validBlob;
      assert.equal(projectRows.get(projectId).thumbnail_url, validBlob.url);
    }
    const removed = await thumbnailApi.DELETE(request("DELETE", { id: projectId }));
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).project.thumbnailUrl, null);
    assert.equal(projectRows.has(projectId), true);
    assert.equal(projectRows.has(otherId), true);
  } finally {
    delete globalThis.thumbnailTestCookie;
  }
});