import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sqlQueries = [];
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
  return { rows: [], rowCount: 0 };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const cookies = async () => ({ get: (name) => name === 'menova_admin' && globalThis.adminTestCookie ? { value: globalThis.adminTestCookie } : undefined, set: (name, value, options) => { globalThis.adminTestCookie = value; globalThis.adminTestCookieOptions = options; }, delete: () => { delete globalThis.adminTestCookie; } });", shortCircuit: true };
    }
    if (specifier === "@vercel/postgres") {
      return { url: "data:text/javascript,export const sql = (...args) => globalThis.adminTestSql(...args);", shortCircuit: true };
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

const auth = await import("../lib/admin-session.ts");
const testVersion = "186d4bc7-962f-4de3-a270-e4846a126a0b";
process.env.AUTH_SECRET = "test-secret-only-not-a-production-secret";
process.env.ADMIN_PASSWORD = "test-password-only-not-for-production";

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
const { PATCH } = await import("../app/api/admin/contacts/route.ts");
const { POST: updatePassword } = await import("../app/api/admin/password/route.ts");
const { POST: signIn, DELETE: signOut } = await import("../app/api/admin/session/route.ts");

test("private data reads and status updates require admin before any SQL", async () => {
  await assert.rejects(getAnalytics(), { code: "unauthorized" });
  await assert.rejects(getInquiries("", "", 1), { code: "unauthorized" });
  const response = await PATCH(new Request("https://archviz.example/api/admin/contacts", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 401);
  const passwordResponse = await updatePassword(adminRequest("password", {}));
  assert.equal(passwordResponse.status, 401);
  assert.deepEqual(sqlQueries, []);
});

const { getSession } = await import("../lib/auth.ts");
const credentials = await import("../lib/admin-credentials.ts");
const { isAdmin } = await import("../lib/admin-auth.ts");

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