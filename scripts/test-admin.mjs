import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const sqlQueries = [];
let credentialRow = null;
globalThis.adminTestSql = async (strings, ...values) => {
  const text = strings.join("?");
  sqlQueries.push({ text, values });
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
      return { url: "data:text/javascript,export const cookies = async () => ({ get: (name) => name === 'menova_admin' && globalThis.adminTestCookie ? { value: globalThis.adminTestCookie } : undefined });", shortCircuit: true };
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

test("private data reads and status updates require admin before any SQL", async () => {
  await assert.rejects(getAnalytics(), { code: "unauthorized" });
  await assert.rejects(getInquiries("", "", 1), { code: "unauthorized" });
  const response = await PATCH(new Request("https://archviz.example/api/admin/contacts", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 401);
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