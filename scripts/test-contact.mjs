import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const queries = [];
let attempts = 1;
let failStorage = false;
globalThis.contactTestSql = async (strings, ...values) => {
  if (failStorage) throw new Error("postgres://private-credentials.example private@example.com");
  queries.push({ text: strings.join("?"), values });
  return { rows: [{ attempts }], rowCount: 1 };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@vercel/postgres") {
      return { url: "data:text/javascript,export const sql = (...args) => globalThis.contactTestSql(...args);", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root);
      if (existsSync(fileURLToPath(target) + ".ts")) target.pathname += ".ts";
      return { url: target.href, shortCircuit: true };
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

const { parseContact, CONTACT_LIMITS } = await import("../lib/contact.ts");
const valid = {
  submissionId: "186d4bc7-962f-4de3-a270-e4846a126a0b",
  name: "  Alex Example  ",
  email: " Alex@Example.com ",
  phone: " +44 7700 900123 ",
  company: " Example Studio ",
  message: "  I need an architectural walkthrough of a residential project.  ",
  website: "",
};

test("contact fields are normalized and optional contact details are retained", () => {
  assert.deepEqual(parseContact(valid), {
    submissionId: valid.submissionId,
    name: "Alex Example",
    email: "alex@example.com",
    phone: "+44 7700 900123",
    company: "Example Studio",
    message: valid.message.trim(),
  });
  assert.equal(parseContact({ ...valid, phone: undefined, company: undefined }).phone, "");
});

test("missing or malformed contact submissions are rejected", () => {
  for (const raw of [null, [], "text", {}, { ...valid, name: " " },
    { ...valid, email: "not-an-email" }, { ...valid, email: "alex@example.com\nBcc:other@example.com" },
    { ...valid, phone: 123 }, { ...valid, message: "short" },
    { ...valid, submissionId: "invalid" }, { ...valid, company: "invalid\0value" }]) {
    assert.throws(() => parseContact(raw), { code: "invalid_request" });
  }
});

test("every persisted contact field has a server-enforced size limit", () => {
  for (const [field, limit] of Object.entries(CONTACT_LIMITS)) {
    assert.throws(() => parseContact({ ...valid, [field]: "x".repeat(limit + 1) }),
      { code: "invalid_request" });
  }
});

test("spam-trap submissions do not produce a contact record", () => {
  assert.equal(parseContact({ ...valid, website: "https://spam.example" }), null);
  assert.throws(() => parseContact({ ...valid, website: {} }), { code: "invalid_request" });
});

const { POST } = await import("../app/api/contact/route.ts");
const { assertSameOrigin } = await import("../lib/request-security.ts");
const request = (body, headers = {}) => new Request("https://archviz.example/api/contact", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://archviz.example", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("invalid, cross-origin and oversized bodies are rejected before storage", async () => {
  const before = queries.length;
  for (const [body, headers, expected] of [
    ["{broken", {}, 400], [{ ...valid, email: "invalid" }, {}, 400],
    [valid, { Origin: "https://other.example" }, 403],
    [valid, { "Sec-Fetch-Site": "cross-site" }, 403],
    [valid, { "Content-Type": "text/plain" }, 415],
    [valid, { "Content-Length": "40000" }, 413], ["x".repeat(40000), {}, 413],
  ]) assert.equal((await POST(request(body, headers))).status, expected);
  assert.equal(queries.length, before);
});

test("same-origin checks use the public Host when Next reconstructs an internal URL", () => {
  const internalRequest = (origin) => new Request("http://localhost:3001/api/contact", {
    headers: { Host: "127.0.0.1:3001", Origin: origin, "Sec-Fetch-Site": "same-origin" },
  });
  assert.doesNotThrow(() => assertSameOrigin(internalRequest("http://127.0.0.1:3001")));
  assert.throws(() => assertSameOrigin(internalRequest("https://other.example")), { code: "forbidden" });
  assert.throws(() => assertSameOrigin(internalRequest("null")), { code: "forbidden" });
});

test("spam trap is accepted neutrally without persisting contact details", async () => {
  const before = queries.length;
  const response = await POST(request({ ...valid, website: "spam" }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(queries.length, before);
});

test("valid enquiries use parameterized SQL and a duplicate-protected submission id", async () => {
  process.env.POSTGRES_URL = "test-only";
  const response = await POST(request({ ...valid, name: "O'Brien" }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { received: true });
  const insert = queries.at(-1);
  assert.match(insert.text, /INSERT INTO contact_inquiries/);
  assert.match(insert.text, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(insert.text, /O'Brien/);
  assert.deepEqual(insert.values, [valid.submissionId, "O'Brien", "alex@example.com", "+44 7700 900123", "Example Studio", valid.message.trim()]);
});

test("rate limits reject excessive submissions without inserting an enquiry", async () => {
  attempts = 11;
  const before = queries.filter((query) => query.text.includes("INSERT INTO contact_inquiries")).length;
  const response = await POST(request(valid));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "900");
  assert.equal(queries.filter((query) => query.text.includes("INSERT INTO contact_inquiries")).length, before);
  attempts = 1;
});

test("storage errors never expose credentials or client information", async () => {
  const log = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(" "));
  failStorage = true;
  try {
    const response = await POST(request(valid));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /postgres:|private-credentials|private@example/);
    assert.doesNotMatch(logs.join(" "), /postgres:|private-credentials|private@example/);
  } finally {
    failStorage = false;
    console.error = log;
  }
});