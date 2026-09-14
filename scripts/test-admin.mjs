import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sqlQueries = [];
const inquiryIds = new Set();
const modelRows = new Map();
const deletedModelUrls = [];
globalThis.adminTestDeleteBlob = async (url) => { deletedModelUrls.push(url); };
let credentialRow = null;
let rateAttempts = 1;
globalThis.adminTestSql = async (strings, ...values) => {
  const text = strings.join("?");
  sqlQueries.push({ text, values });
  if (text.includes("INSERT INTO request_limits")) return { rows: [{ attempts: rateAttempts }], rowCount: 1 };
  if (text.includes("SELECT password_hash")) return { rows: credentialRow ? [credentialRow] : [], rowCount: credentialRow ? 1 : 0 };
  if (text.includes("INSERT INTO admin_credentials") && !credentialRow) {
    credentialRow = { password_hash: values[0], version: values[1], updated_at: new Date() };
    return { rows: [], rowCount: 1 };
  }
  if (text.includes("UPDATE admin_credentials") && credentialRow?.version === values[2]) {
    credentialRow = { password_hash: values[0], version: values[1], updated_at: new Date() };
    return { rows: [], rowCount: 1 };
  }
  if (text.includes("DELETE FROM contact_inquiries")) {
    return { rows: [], rowCount: inquiryIds.delete(values[0]) ? 1 : 0 };
  }
  if (text.includes("DELETE FROM projects")) {
    const row = modelRows.get(values[0]);
    if (!row || row.owner_id !== values[1]) return { rows: [], rowCount: 0 };
    assert.equal(deletedModelUrls.at(-1), row.blob_url);
    modelRows.delete(row.id);
    return { rows: [row], rowCount: 1 };
  }
  if (text.includes("UPDATE projects") && text.includes("SET is_public =")) {
    const row = modelRows.get(values[1]);
    if (!row || row.owner_id !== values[2]) return { rows: [], rowCount: 0 };
    const updated = { ...row, is_public: values[0] };
    modelRows.set(row.id, updated);
    return { rows: [updated], rowCount: 1 };
  }
  if (text.includes("FROM projects") && text.includes("WHERE id =")) {
    const row = modelRows.get(values[0]);
    const visible = !text.includes("AND (is_public = TRUE OR") || row?.is_public || values[1] === true;
    return { rows: row && visible ? [row] : [], rowCount: row && visible ? 1 : 0 };
  }
  if (text.includes("FROM projects") && text.includes("WHERE owner_id =")) {
    const rows = [...modelRows.values()].filter(row => row.owner_id === values[0] &&
      (!text.includes("AND (is_public = TRUE OR") || row.is_public || values[1] === true));
    return { rows, rowCount: rows.length };
  }
  return { rows: [], rowCount: 0 };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const cookies = async () => ({ get: (name) => name === 'menova_admin' && globalThis.adminTestCookie ? { value: globalThis.adminTestCookie } : undefined, set: (name, value, options) => { globalThis.adminTestCookie = value; globalThis.adminTestCookieOptions = options; }, delete: () => { delete globalThis.adminTestCookie; } });", shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier === "@/app/viewer/[id]/ViewerClient") {
      return { url: "data:text/javascript,export default function ViewerClient() { return null; }", shortCircuit: true };
    }
    if (specifier === "@vercel/postgres") {
      return { url: "data:text/javascript,export const sql = (...args) => globalThis.adminTestSql(...args);", shortCircuit: true };
    }
    if (specifier === "@vercel/blob") {
      return { url: "data:text/javascript,export const del = (...args) => globalThis.adminTestDeleteBlob(...args);", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(
        readFileSync(new URL(url), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
      ).outputText };
    }
    return nextLoad(url, context);
  },
});

const auth = await import("../lib/admin-session.ts");
const testVersion = "186d4bc7-962f-4de3-a270-e4846a126a0b";
process.env.AUTH_SECRET = "test-secret-only-not-a-production-secret";
process.env.ADMIN_PASSWORD = "test-password-only-not-for-production";

test("password forms cannot fall back to GET requests before hydration", () => {
  for (const file of ["app/admin/login/LoginForm.tsx", "app/admin/PasswordForm.tsx"]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.match(source, /<form\s[^>]*method="post"[^>]*action="\/api\/admin\/(session|password)"/);
  }
});

test("admin sessions cannot be granted by anonymous mode or old cookies", () => {
  process.env.ALLOW_ANONYMOUS = "true";
  assert.equal(auth.verifyAdminSession(undefined, testVersion), false);
  assert.equal(auth.verifyAdminSession("public.fake-signature", testVersion), false);
});

test("admin sessions expire after eight hours and cannot be tampered with", () => {
  const now = Date.now();
  const session = auth.createAdminSession(testVersion, now);
  assert.equal(auth.verifyAdminSession(session, testVersion, now), true);
  assert.equal(auth.verifyAdminSession(session + "changed", testVersion, now), false);
  assert.equal(auth.verifyAdminSession(session.replace(/^\d+/, "9999999999"), testVersion, now), false);
  assert.equal(auth.verifyAdminSession(session, testVersion, now + auth.ADMIN_SESSION_SECONDS * 1000), false);
  assert.equal(auth.verifyAdminSession(session, "286d4bc7-962f-4de3-a270-e4846a126a0b", now), false);
});

test("missing or weak configuration fails closed", () => {
  const secret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "short";
  assert.equal(auth.adminSigningConfigured(), false);
  assert.throws(() => auth.createAdminSession(testVersion));
  assert.equal(auth.verifyAdminSession("anything", testVersion), false);
  process.env.AUTH_SECRET = secret;
});

const { getAnalytics, getInquiries } = await import("../lib/admin-data.ts");
const { PATCH, DELETE: deleteInquiry } = await import("../app/api/admin/contacts/route.ts");
const { GET: getModels, PATCH: updateModel, DELETE: deleteModel } = await import("../app/api/projects/route.ts");
const { POST: updatePassword } = await import("../app/api/admin/password/route.ts");
const { POST: signIn, DELETE: signOut } = await import("../app/api/admin/session/route.ts");

test("private data reads and enquiry mutations require admin before any SQL", async () => {
  await assert.rejects(getAnalytics(), { code: "unauthorized" });
  await assert.rejects(getInquiries("", "", 1), { code: "unauthorized" });
  const response = await PATCH(new Request("https://archviz.example/api/admin/contacts", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 401);
  const deleteResponse = await deleteInquiry(deleteInquiryRequest({ id: testVersion }));
  assert.equal(deleteResponse.status, 401);
  const passwordResponse = await updatePassword(adminRequest("password", {}));
  assert.equal(passwordResponse.status, 401);
  assert.deepEqual(sqlQueries, []);
});

test("model deletion requires admin even when anonymous model access is enabled", async () => {
  const previous = process.env.ALLOW_ANONYMOUS;
  process.env.ALLOW_ANONYMOUS = "true";
  const queryCount = sqlQueries.length;
  try {
    const response = await deleteModel(new Request("https://archviz.example/api/projects?id=proj_12345678", {
      method: "DELETE", headers: { Origin: "https://archviz.example" },
    }));
    assert.equal(response.status, 401);
    assert.equal(sqlQueries.length, queryCount);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previous;
  }
});

const { getSession } = await import("../lib/auth.ts");
const credentials = await import("../lib/admin-credentials.ts");
const { isAdmin } = await import("../lib/admin-auth.ts");
const { getProject, listProjects } = await import("../lib/db.ts");
const { default: ViewerPage, generateMetadata } = await import("../app/viewer/[id]/page.tsx");

function modelRequest(body, headers = {}, id = "proj_12345678") {
  return new Request(`https://archviz.example/api/projects?id=${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://archviz.example", ...headers },
    body: JSON.stringify(body),
  });
}

test("model visibility changes require admin even for anonymous and valid bearer sessions", async () => {
  const previousAnonymous = process.env.ALLOW_ANONYMOUS;
  const previousToken = process.env.MENOVA_API_TOKEN;
  process.env.ALLOW_ANONYMOUS = "true";
  process.env.MENOVA_API_TOKEN = "test-visibility-token-not-for-production";
  const queryCount = sqlQueries.length;
  try {
    for (const headers of [{}, { Authorization: `Bearer ${process.env.MENOVA_API_TOKEN}` }]) {
      for (const isPublic of [false, true]) {
        assert.equal((await updateModel(modelRequest({ isPublic }, headers))).status, 401);
      }
    }
    assert.equal(sqlQueries.length, queryCount);
  } finally {
    if (previousAnonymous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previousAnonymous;
    if (previousToken === undefined) delete process.env.MENOVA_API_TOKEN;
    else process.env.MENOVA_API_TOKEN = previousToken;
  }
});

test("model visibility rejects cross-site and invalid admin updates before touching models", async () => {
  process.env.POSTGRES_URL = "test-only";
  const stored = await credentials.getAdminCredentials();
  globalThis.adminTestCookie = auth.createAdminSession(stored.version);
  const queryCount = sqlQueries.length;
  try {
    for (const headers of [
      { Origin: "https://other.example" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      assert.equal((await updateModel(modelRequest({ isPublic: false }, headers))).status, 403);
    }
    for (const body of [{ isPublic: "false" }, { isPublic: null }, { isPublic: 1 }, { isPublic: false, hotspots: [] }]) {
      assert.equal((await updateModel(modelRequest(body))).status, 400);
    }
    assert.equal((await updateModel(modelRequest({ isPublic: false }, {}, "bad-id"))).status, 400);
    assert.equal(sqlQueries.slice(queryCount).some(({ text }) => text.includes("projects")), false);
  } finally {
    delete globalThis.adminTestCookie;
  }
});

test("admins can hide and republish one model without changing other models or hotspots", async () => {
  const previous = process.env.ALLOW_ANONYMOUS;
  process.env.ALLOW_ANONYMOUS = "false";
  process.env.POSTGRES_URL = "test-only";
  const stored = await credentials.getAdminCredentials();
  globalThis.adminTestCookie = auth.createAdminSession(stored.version);
  const row = {
    id: "proj_12345678", title: "Visibility test", blob_url: "https://blob.example/test.glb",
    blob_pathname: "test.glb", size_bytes: 128, created_at: "2026-09-14T00:00:00.000Z",
    owner_id: "public", upload_ref: "visibility-test-upload", is_public: true,
    hotspots: [{ id: "entry", label: "Entry", position: { x: 0, y: 0, z: 0 }, yaw: 0 }],
  };
  const other = { ...row, id: "proj_87654321" };
  const foreign = { ...row, id: "proj_11111111", owner_id: "another-owner" };
  modelRows.set(row.id, row);
  modelRows.set(other.id, other);
  modelRows.set(foreign.id, foreign);
  const blobCount = deletedModelUrls.length;
  try {
    for (const isPublic of [false, true]) {
      const response = await updateModel(modelRequest({ isPublic }));
      assert.equal(response.status, 200);
      const { project } = await response.json();
      assert.equal(project.id, row.id);
      assert.equal(project.isPublic, isPublic);
      assert.deepEqual(project.hotspots, row.hotspots);
      assert.equal((await getProject(row.id))?.isPublic ?? false, isPublic);
      assert.deepEqual(modelRows.get(other.id), other);
      assert.deepEqual(modelRows.get(foreign.id), foreign);
    }
    assert.equal((await updateModel(modelRequest({ isPublic: false }, {}, foreign.id))).status, 404);
    assert.equal((await updateModel(modelRequest({ isPublic: false }, {}, "proj_22222222"))).status, 404);
    assert.equal(deletedModelUrls.length, blobCount);
  } finally {
    delete globalThis.adminTestCookie;
    modelRows.clear();
    if (previous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previous;
  }
});

test("hidden models are excluded from default reads but available to admin reads", async () => {
  const previous = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = "test-only";
  const publicRow = {
    id: "proj_12345678", title: "Public model", blob_url: "https://blob.example/public.glb",
    blob_pathname: "public.glb", size_bytes: 128, created_at: "2026-09-14T00:00:00.000Z",
    owner_id: "public", upload_ref: "public-test-upload", hotspots: [], is_public: true,
  };
  const hiddenRow = { ...publicRow, id: "proj_87654321", title: "Hidden model", is_public: false };
  modelRows.set(publicRow.id, publicRow);
  modelRows.set(hiddenRow.id, hiddenRow);
  try {
    assert.equal(await getProject(hiddenRow.id), null);
    assert.equal((await getProject(hiddenRow.id, true)).isPublic, false);
    assert.equal((await getProject(publicRow.id)).isPublic, true);
    assert.deepEqual((await listProjects("public")).map(project => project.id), [publicRow.id]);
    assert.deepEqual((await listProjects("public", true)).map(project => project.id), [publicRow.id, hiddenRow.id]);
  } finally {
    modelRows.clear();
    if (previous === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = previous;
  }
});

test("public model APIs exclude hidden models and deny hotspot edits while admins can list them", async () => {
  const previous = process.env.ALLOW_ANONYMOUS;
  process.env.ALLOW_ANONYMOUS = "true";
  process.env.POSTGRES_URL = "test-only";
  const publicRow = {
    id: "proj_12345678", title: "Public model", blob_url: "https://blob.example/public.glb",
    blob_pathname: "public.glb", size_bytes: 128, created_at: "2026-09-14T00:00:00.000Z",
    owner_id: "public", upload_ref: "public-test-upload", hotspots: [], is_public: true,
  };
  const hiddenRow = { ...publicRow, id: "proj_87654321", title: "Hidden model", is_public: false };
  modelRows.set(publicRow.id, publicRow);
  modelRows.set(hiddenRow.id, hiddenRow);
  try {
    const publicResponse = await getModels(new Request("https://archviz.example/api/projects?includeHidden=true"));
    assert.equal(publicResponse.status, 200);
    assert.deepEqual((await publicResponse.json()).projects.map(project => project.id), [publicRow.id]);
    assert.equal((await updateModel(modelRequest({ hotspots: [] }, {}, hiddenRow.id))).status, 404);
    assert.deepEqual(modelRows.get(hiddenRow.id), hiddenRow);
    const stored = await credentials.getAdminCredentials();
    globalThis.adminTestCookie = auth.createAdminSession(stored.version);
    const adminResponse = await getModels(new Request("https://archviz.example/api/projects"));
    assert.equal(adminResponse.status, 200);
    assert.deepEqual((await adminResponse.json()).projects.map(project => project.id), [publicRow.id, hiddenRow.id]);
  } finally {
    delete globalThis.adminTestCookie;
    modelRows.clear();
    if (previous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previous;
  }
});

test("model deletion rejects valid non-admin bearer sessions", async () => {
  const previous = process.env.MENOVA_API_TOKEN;
  process.env.MENOVA_API_TOKEN = "test-model-token-not-for-production";
  const request = new Request("https://archviz.example/api/projects?id=proj_12345678", {
    method: "DELETE", headers: { Origin: "https://archviz.example", Authorization: `Bearer ${process.env.MENOVA_API_TOKEN}` },
  });
  const queryCount = sqlQueries.length;
  const blobCount = deletedModelUrls.length;
  try {
    assert.deepEqual(await getSession(request), { userId: "public", source: "bearer" });
    assert.equal((await deleteModel(request)).status, 401);
    assert.equal(sqlQueries.length, queryCount);
    assert.equal(deletedModelUrls.length, blobCount);
  } finally {
    if (previous === undefined) delete process.env.MENOVA_API_TOKEN;
    else process.env.MENOVA_API_TOKEN = previous;
  }
});

test("hidden viewer pages and metadata are unavailable to visitors but admins can preview", async () => {
  process.env.POSTGRES_URL = "test-only";
  const row = {
    id: "proj_12345678", title: "Unpublished model", blob_url: "https://blob.example/hidden.glb",
    blob_pathname: "hidden.glb", size_bytes: 128, created_at: "2026-09-14T00:00:00.000Z",
    owner_id: "public", upload_ref: "hidden-viewer-test", hotspots: [], is_public: false,
  };
  const props = { params: Promise.resolve({ id: row.id }), searchParams: Promise.resolve({ edit: "1" }) };
  modelRows.set(row.id, row);
  try {
    assert.deepEqual(await generateMetadata(props), { title: "Space not found" });
    await assert.rejects(ViewerPage(props), { message: "NEXT_HTTP_ERROR_FALLBACK;404" });
    const stored = await credentials.getAdminCredentials();
    globalThis.adminTestCookie = auth.createAdminSession(stored.version);
    assert.equal((await generateMetadata(props)).title, row.title);
    assert.equal((await ViewerPage(props)).props.project.id, row.id);
    delete globalThis.adminTestCookie;
    modelRows.set(row.id, { ...row, is_public: true });
    assert.equal((await generateMetadata(props)).title, row.title);
    assert.equal((await ViewerPage(props)).props.project.id, row.id);
  } finally {
    delete globalThis.adminTestCookie;
    modelRows.clear();
  }
});

test("model deletion rejects cross-site admin requests before accessing models", async () => {
  process.env.POSTGRES_URL = "test-only";
  const stored = await credentials.getAdminCredentials();
  globalThis.adminTestCookie = auth.createAdminSession(stored.version);
  const queryCount = sqlQueries.length;
  const blobCount = deletedModelUrls.length;
  try {
    for (const headers of [
      { Origin: "https://other.example" },
      { Origin: "https://archviz.example", "Sec-Fetch-Site": "cross-site" },
    ]) {
      const response = await deleteModel(new Request("https://archviz.example/api/projects?id=proj_12345678", {
        method: "DELETE", headers,
      }));
      assert.equal(response.status, 403);
    }
    assert.equal(sqlQueries.slice(queryCount).some(({ text }) => text.includes("projects")), false);
    assert.equal(deletedModelUrls.length, blobCount);
  } finally {
    delete globalThis.adminTestCookie;
  }
});

test("model deletion lets admins remove only the selected model with anonymous access disabled", async () => {
  const previous = process.env.ALLOW_ANONYMOUS;
  process.env.ALLOW_ANONYMOUS = "false";
  process.env.POSTGRES_URL = "test-only";
  const stored = await credentials.getAdminCredentials();
  globalThis.adminTestCookie = auth.createAdminSession(stored.version);
  const row = {
    id: "proj_12345678", title: "Deletion test", blob_url: "https://blob.example/test.glb",
    blob_pathname: "test.glb", size_bytes: 128, created_at: "2026-09-14T00:00:00.000Z",
    owner_id: "public", upload_ref: "test-upload-ref", hotspots: [], is_public: true,
  };
  const otherId = "proj_87654321";
  modelRows.set(otherId, { ...row, id: otherId });
  const blobCount = deletedModelUrls.length;
  try {
    for (const request of [
      new Request(`https://archviz.example/api/projects?id=${row.id}`, {
        method: "DELETE", headers: { Origin: "https://archviz.example" },
      }),
      new Request("https://archviz.example/api/projects", {
        method: "DELETE", headers: { Origin: "https://archviz.example", "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      }),
    ]) {
      modelRows.set(row.id, { ...row, is_public: request.headers.get("content-type") !== "application/json" });
      const response = await deleteModel(request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: row.id, deleted: true });
      assert.equal(modelRows.has(row.id), false);
      assert.equal(modelRows.has(otherId), true);
    }
    assert.deepEqual(deletedModelUrls.slice(blobCount), [row.blob_url, row.blob_url]);
  } finally {
    delete globalThis.adminTestCookie;
    modelRows.clear();
    if (previous === undefined) delete process.env.ALLOW_ANONYMOUS;
    else process.env.ALLOW_ANONYMOUS = previous;
  }
});

test("admin sessions authorize model operations with anonymous access disabled", async () => {
  process.env.ALLOW_ANONYMOUS = "false";
  assert.equal(await getSession(), null);
  process.env.POSTGRES_URL = "test-only";
  const stored = await credentials.getAdminCredentials();
  globalThis.adminTestCookie = auth.createAdminSession(stored.version);
  try {
    assert.deepEqual(await getSession(), { userId: "public", source: "admin" });
  } finally {
    delete globalThis.adminTestCookie;
  }
  assert.equal(await getSession(), null);
});

test("bootstrap stores a salted hash once and does not overwrite a profile password", async () => {
  process.env.POSTGRES_URL = "test-only";
  const original = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "setup1234";
  credentialRow = null;
  try {
    const first = await credentials.getAdminCredentials();
    assert.ok(first);
    assert.doesNotMatch(first.password_hash, /setup1234/);
    assert.equal(await credentials.matchesAdminPassword("setup1234", first.password_hash), true);
    assert.equal(await credentials.matchesAdminPassword("wrong", first.password_hash), false);
    process.env.ADMIN_PASSWORD = "a-different-bootstrap-password";
    assert.deepEqual(await credentials.getAdminCredentials(), first);
    const secondHash = await credentials.hashAdminPassword("setup1234");
    assert.notEqual(secondHash, first.password_hash);
  } finally {
    process.env.ADMIN_PASSWORD = original;
  }
});

test("profile changes require the current password and rotate the credential version", async () => {
  const previous = await credentials.getAdminCredentials();
  const oldSession = auth.createAdminSession(previous.version);
  globalThis.adminTestCookie = oldSession;
  assert.equal(await isAdmin(), true);
  await assert.rejects(credentials.changeAdminPassword("wrong", "a-strong-new-test-password"), { code: "unauthorized" });
  await assert.rejects(credentials.changeAdminPassword("setup1234", "short"), { code: "invalid_request" });
  const nextVersion = await credentials.changeAdminPassword("setup1234", "a-strong-new-test-password");
  assert.notEqual(nextVersion, previous.version);
  const updated = await credentials.getAdminCredentials();
  assert.equal(updated.version, nextVersion);
  assert.equal(await isAdmin(), false);
  assert.equal(auth.verifyAdminSession(oldSession, nextVersion), false);
  delete globalThis.adminTestCookie;
  assert.equal(await credentials.matchesAdminPassword("setup1234", updated.password_hash), false);
  assert.equal(await credentials.matchesAdminPassword("a-strong-new-test-password", updated.password_hash), true);
  await assert.rejects(credentials.changeAdminPassword("a-strong-new-test-password", "a-strong-new-test-password"), { code: "invalid_request" });
});

const testPassword = "initial-password-for-route-tests";
const replacementPassword = "replacement-password-for-route-tests";

function adminRequest(path, body, headers = {}) {
  return new Request(`https://archviz.example/api/admin/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://archviz.example", ...headers },
    body: JSON.stringify(body),
  });
}

async function prepareAdminForTest() {
  credentialRow = { password_hash: await credentials.hashAdminPassword(testPassword), version: testVersion, updated_at: new Date() };
  rateAttempts = 1;
  globalThis.adminTestCookie = auth.createAdminSession(testVersion);
  delete globalThis.adminTestCookieOptions;
  sqlQueries.length = 0;
}

function passwordChangeBody(overrides = {}) {
  return { currentPassword: testPassword, newPassword: replacementPassword, confirmPassword: replacementPassword, ...overrides };
}

test("uninitialized credentials fail closed without a valid bootstrap", async () => {
  const original = process.env.ADMIN_PASSWORD;
  credentialRow = null;
  try {
    delete process.env.ADMIN_PASSWORD;
    assert.equal(await credentials.getAdminCredentials(), null);
    process.env.ADMIN_PASSWORD = "short";
    assert.equal(await credentials.getAdminCredentials(), null);
    assert.equal(await credentials.matchesAdminPassword(undefined, "scrypt:invalid"), false);
    assert.equal(await credentials.matchesAdminPassword("password", "scrypt:invalid"), false);
  } finally {
    process.env.ADMIN_PASSWORD = original;
  }
});

test("login uses the database password and sets a private eight-hour cookie", async () => {
  await prepareAdminForTest();
  delete globalThis.adminTestCookie;
  const bootstrapLogin = await signIn(adminRequest("session", { password: process.env.ADMIN_PASSWORD }));
  assert.equal(bootstrapLogin.status, 401);
  assert.equal(globalThis.adminTestCookie, undefined);
  const login = await signIn(adminRequest("session", { password: testPassword }));
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("Cache-Control"), "no-store");
  assert.equal(await isAdmin(), true);
  assert.deepEqual(globalThis.adminTestCookieOptions, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: auth.ADMIN_SESSION_SECONDS,
  });
  delete globalThis.adminTestCookie;
});

test("password endpoint rejects cross-site, malformed and mismatched requests without changing credentials", async () => {
  await prepareAdminForTest();
  const original = credentialRow;
  const crossSite = await updatePassword(adminRequest("password", passwordChangeBody(), { Origin: "https://other.example" }));
  assert.equal(crossSite.status, 403);
  const crossSiteFetch = await updatePassword(adminRequest("password", passwordChangeBody(), { "Sec-Fetch-Site": "cross-site" }));
  assert.equal(crossSiteFetch.status, 403);
  for (const body of [null, {}, [], passwordChangeBody({ confirmPassword: "does-not-match" }), passwordChangeBody({ confirmPassword: undefined })]) {
    const response = await updatePassword(adminRequest("password", body));
    assert.equal(response.status, 400);
  }
  const wrongType = await updatePassword(adminRequest("password", passwordChangeBody(), { "Content-Type": "text/plain" }));
  assert.equal(wrongType.status, 415);
  const oversized = await updatePassword(adminRequest("password", passwordChangeBody({ currentPassword: "a".repeat(33_000) })));
  assert.equal(oversized.status, 413);
  assert.equal(credentialRow, original);
  assert.equal(globalThis.adminTestCookieOptions, undefined);
  assert.equal(sqlQueries.some(({ text }) => text.includes("UPDATE admin_credentials")), false);
  delete globalThis.adminTestCookie;
});

test("password endpoint requires the current password and enforces new-password limits", async () => {
  await prepareAdminForTest();
  const original = credentialRow;
  const wrongPassword = await updatePassword(adminRequest("password", passwordChangeBody({ currentPassword: "wrong-password" })));
  assert.equal(wrongPassword.status, 401);
  for (const candidate of ["short", "a".repeat(1025), testPassword]) {
    const response = await updatePassword(adminRequest("password", passwordChangeBody({ newPassword: candidate, confirmPassword: candidate })));
    assert.equal(response.status, 400);
  }
  assert.equal(credentialRow, original);
  assert.equal(globalThis.adminTestCookieOptions, undefined);
  delete globalThis.adminTestCookie;
});

test("login and password changes are rate limited before password hashing or updates", async () => {
  await prepareAdminForTest();
  rateAttempts = 11;
  const original = credentialRow;
  for (const response of [
    await updatePassword(adminRequest("password", passwordChangeBody())),
    await signIn(adminRequest("session", { password: testPassword })),
  ]) {
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "900");
  }
  assert.equal(credentialRow, original);
  assert.equal(globalThis.adminTestCookieOptions, undefined);
  rateAttempts = 1;
  delete globalThis.adminTestCookie;
});

test("a password change renews the current session, revokes old sessions, and survives logout", async () => {
  await prepareAdminForTest();
  const oldCookie = globalThis.adminTestCookie;
  const response = await updatePassword(adminRequest("password", passwordChangeBody()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { changed: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const renewedCookie = globalThis.adminTestCookie;
  assert.notEqual(renewedCookie, oldCookie);
  assert.equal(await isAdmin(), true);
  globalThis.adminTestCookie = oldCookie;
  assert.equal(await isAdmin(), false);
  assert.equal(await getSession(), null);
  const revoked = await updatePassword(adminRequest("password", passwordChangeBody()));
  assert.equal(revoked.status, 401);
  globalThis.adminTestCookie = renewedCookie;
  assert.equal((await signOut(new Request("https://archviz.example/api/admin/session", { method: "DELETE" }))).status, 200);
  assert.equal(await isAdmin(), false);
  assert.equal((await signIn(adminRequest("session", { password: testPassword }))).status, 401);
  assert.equal((await signIn(adminRequest("session", { password: replacementPassword }))).status, 200);
  assert.equal(await isAdmin(), true);
  delete globalThis.adminTestCookie;
});

test("concurrent password changes cannot overwrite a completed change", async () => {
  await prepareAdminForTest();
  const results = await Promise.allSettled([
    credentials.changeAdminPassword(testPassword, replacementPassword),
    credentials.changeAdminPassword(testPassword, "another-strong-test-password"),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.find(({ status }) => status === "rejected").reason.code, "conflict");
  assert.equal(await isAdmin(), false);
  delete globalThis.adminTestCookie;
});

function deleteInquiryRequest(body, headers = {}) {
  return new Request("https://archviz.example/api/admin/contacts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: "https://archviz.example", ...headers },
    body: JSON.stringify(body),
  });
}

test("enquiry deletion rejects cross-site and invalid requests before changing contacts", async () => {
  await prepareAdminForTest();
  try {
    for (const headers of [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
      const response = await deleteInquiry(deleteInquiryRequest({ id: testVersion }, headers));
      assert.equal(response.status, 403);
    }
    for (const body of [null, {}, [], { id: 1 }, { id: "invalid" }, { id: "-".repeat(36) }, { id: "' OR true; --" }]) {
      const response = await deleteInquiry(deleteInquiryRequest(body));
      assert.equal(response.status, 400);
    }
    const malformed = await deleteInquiry(new Request("https://archviz.example/api/admin/contacts", {
      method: "DELETE", headers: { "Content-Type": "application/json", Origin: "https://archviz.example" }, body: "{",
    }));
    assert.equal(malformed.status, 400);
    const wrongType = await deleteInquiry(deleteInquiryRequest({ id: testVersion }, { "Content-Type": "text/plain" }));
    assert.equal(wrongType.status, 415);
    const oversized = await deleteInquiry(deleteInquiryRequest({ id: "a".repeat(2049) }));
    assert.equal(oversized.status, 413);
    assert.equal(sqlQueries.some(({ text }) => text.includes("contact_inquiries")), false);
  } finally {
    delete globalThis.adminTestCookie;
  }
});

test("enquiry deletion removes only the selected ID and reports already deleted contacts", async () => {
  await prepareAdminForTest();
  const otherId = "286d4bc7-962f-4de3-a270-e4846a126a0b";
  inquiryIds.add(testVersion);
  inquiryIds.add(otherId);
  try {
    const response = await deleteInquiry(deleteInquiryRequest({ id: testVersion }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual([...inquiryIds], [otherId]);
    assert.deepEqual(sqlQueries.filter(({ text }) => text.includes("DELETE FROM contact_inquiries")), [
      { text: "DELETE FROM contact_inquiries WHERE id = ?;", values: [testVersion] },
    ]);
    const missing = await deleteInquiry(deleteInquiryRequest({ id: testVersion }));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "Enquiry not found.");
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    assert.deepEqual([...inquiryIds], [otherId]);
  } finally {
    inquiryIds.clear();
    delete globalThis.adminTestCookie;
  }
});