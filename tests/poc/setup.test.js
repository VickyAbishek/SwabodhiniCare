const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { createContext, plain } = require("./harness.js");

const sha = (text) => nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const KEY = sha("first-admin-key");
const SALT = "0123456789abcdef0123456789abcdef";
const WRONG_CODE = "000000000000";

const fresh = () => createContext({ properties: { SHEET_ID: "" } });
const props = (ctx) => ctx.PropertiesService.getScriptProperties();
const call = (ctx, action, data) => plain(ctx.SC_Api.handle({ action, data }));
const firstAdmin = (ctx, code, extra) =>
  call(ctx, "setup.firstAdmin", Object.assign({ code, email: "Anand.K@example.com", name: "Anand K", salt: SALT, key: KEY }, extra));

test("setup creates the data sheet, tabs, centres, secret and a one-time setup code", () => {
  const ctx = fresh();
  const result = plain(ctx.setup());
  assert.ok(props(ctx).getProperty("SHEET_ID"));
  assert.equal(result.tabsCreated.length, 10);
  assert.deepEqual(result.centresAdded, ["TVM", "VLC", "TDP", "SLR"]);
  assert.match(props(ctx).getProperty("HMAC_SECRET"), /^[0-9a-f]{64}$/);
  assert.match(result.setupCode, /^[0-9a-f]{12}$/);
  assert.equal(props(ctx).getProperty("SETUP_CODE"), result.setupCode);
  const vlc = plain(ctx.SC_Store.find("Centres", "code", "VLC"));
  assert.equal(vlc.name_en, "Velachery");
  assert.equal(vlc.name_ta, "வேளச்சேரி");
  assert.equal(vlc.is_active, true);
  assert.ok(ctx.logs.info.some((args) => String(args[0]).includes(result.setupCode)));
});

test("running setup again changes nothing and keeps the same secret and code", () => {
  const ctx = fresh();
  const first = plain(ctx.setup());
  const secret = props(ctx).getProperty("HMAC_SECRET");
  const again = plain(ctx.setup());
  assert.deepEqual(again.tabsCreated, []);
  assert.deepEqual(again.centresAdded, []);
  assert.equal(again.setupCode, first.setupCode);
  assert.equal(props(ctx).getProperty("HMAC_SECRET"), secret);
  assert.equal(ctx.SC_Store.all("Centres").length, 4);
});

test("the first Admin is created with the setup code, which then stops working", () => {
  const ctx = fresh();
  const { setupCode } = plain(ctx.setup());
  const res = firstAdmin(ctx, setupCode);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.roles, ["ADMIN"]);
  assert.equal(res.data.email, "anand.k@example.com");
  assert.equal(res.data.mustChangePassword, false);
  assert.equal(props(ctx).getProperty("SETUP_CODE"), null);
  assert.equal(firstAdmin(ctx, setupCode, { email: "other@example.com" }).error.code, "NOT_ALLOWED");
  assert.equal(call(ctx, "auth.login", { email: "anand.k@example.com", key: KEY }).ok, true);
  assert.ok(plain(ctx.SC_Store.all("Audit")).some((e) => e.action === "setup.first_admin"));
  assert.equal(plain(ctx.setup()).setupCode, null);
});

test("wrong setup codes are refused, and five of them cancel the code", () => {
  const ctx = fresh();
  const { setupCode } = plain(ctx.setup());
  for (let i = 0; i < 5; i += 1) assert.equal(firstAdmin(ctx, WRONG_CODE).error.code, "INVALID_CREDENTIALS");
  assert.equal(props(ctx).getProperty("SETUP_CODE"), null);
  assert.equal(firstAdmin(ctx, setupCode).error.code, "NOT_ALLOWED");
  assert.match(plain(ctx.setup()).setupCode, /^[0-9a-f]{12}$/);
});

test("first-admin details are checked before the code", () => {
  const ctx = fresh();
  const { setupCode } = plain(ctx.setup());
  assert.equal(firstAdmin(ctx, setupCode, { email: "nope" }).error.code, "INVALID_REQUEST");
  assert.equal(firstAdmin(ctx, setupCode, { key: "short" }).error.code, "INVALID_REQUEST");
  assert.equal(firstAdmin(ctx, setupCode, { name: " " }).error.code, "INVALID_REQUEST");
  assert.equal(firstAdmin(ctx, 12345).error.code, "INVALID_REQUEST");
  assert.equal(props(ctx).getProperty("SETUP_CODE"), setupCode);
});
