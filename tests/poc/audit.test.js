const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { createContext, plain } = require("./harness.js");

const sha = (text) => nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const KEYS = { "u-anand": sha("admin-key"), "u-revathi": sha("director-key"), "u-deepa": sha("staff-key") };
const NEW_KEY = sha("new-key");
const SALT = "0123456789abcdef0123456789abcdef";
const MINUTE = 60 * 1000;

function setup() {
  const ctx = createContext({ properties: { HMAC_SECRET: "test-secret" } });
  ctx.SC_Store.ensureTabs();
  const people = [["u-anand", ["ADMIN"]], ["u-revathi", ["DIRECTOR"]], ["u-deepa", ["THERAPIST"]]];
  for (const [id, roles] of people) {
    ctx.SC_Store.insert("Users", {
      id, email: id.slice(2) + "@example.com", name: id, roles, password_hash: sha(KEYS[id]), password_salt: SALT,
      kdf_iterations: 600000, is_active: true, failed_logins: 0, must_change_password: false,
    });
  }
  const login = (id, key = KEYS[id]) => plain(ctx.SC_Api.handle({ action: "auth.login", data: { email: id.slice(2) + "@example.com", key } }));
  const call = (action, data, token) => plain(ctx.SC_Api.handle({ action, data, token }));
  return { ctx, login, call };
}

const entries = (ctx) => plain(ctx.SC_Store.all("Audit"));
const actions = (ctx) => entries(ctx).map((e) => e.action);

test("SC_Audit.log records who did what, to what, and when", () => {
  const { ctx } = setup();
  ctx.SC_Audit.log("u-anand", "test.action", "Users", "u-deepa", { note: "hello" });
  const [row] = entries(ctx);
  assert.equal(row.user_id, "u-anand");
  assert.equal(row.action, "test.action");
  assert.equal(row.entity, "Users");
  assert.equal(row.entity_id, "u-deepa");
  assert.deepEqual(row.details, { note: "hello" });
  assert.equal(row.created_at, "2026-09-15T10:00:00.000Z");
  assert.match(row.id, /^[0-9a-f]{32}$/);
});

test("sign-ins, failures, lockouts and sign-outs are recorded, with no secrets", () => {
  const { ctx, login, call } = setup();
  const admin = login("u-anand").data.token;
  for (let i = 0; i < 5; i += 1) login("u-deepa", NEW_KEY);
  login("u-anand", NEW_KEY.replace(/^./, "0"));
  call("auth.logout", {}, admin);
  assert.deepEqual(actions(ctx), [
    "auth.login", "auth.login_failed", "auth.login_failed", "auth.login_failed", "auth.login_failed",
    "auth.locked", "auth.login_failed", "auth.logout",
  ]);
  const text = JSON.stringify(entries(ctx));
  for (const secret of [KEYS["u-anand"], sha(KEYS["u-anand"]), admin, sha(admin), NEW_KEY]) {
    assert.ok(!text.includes(secret), "audit must not contain keys, hashes or tokens");
  }
});

test("failed sign-ins for unknown emails are recorded against the email", () => {
  const { ctx, call } = setup();
  call("auth.login", { email: "Stranger@Example.com", key: NEW_KEY });
  const [row] = entries(ctx);
  assert.equal(row.action, "auth.login_failed");
  assert.equal(row.user_id, null);
  assert.deepEqual(row.details, { email: "stranger@example.com" });
});

test("account changes are recorded", () => {
  const { ctx, login, call } = setup();
  const admin = login("u-anand").data.token;
  const created = call("users.create", { email: "priya.s@example.com", name: "Priya S", roles: ["THERAPIST"], salt: SALT, key: NEW_KEY }, admin).data;
  call("users.update", { id: "u-deepa", isActive: false }, admin);
  call("users.resetPassword", { id: created.id, salt: SALT, key: NEW_KEY }, admin);
  call("auth.changePassword", { currentKey: KEYS["u-anand"], newSalt: SALT, newKey: NEW_KEY }, admin);
  const log = entries(ctx).filter((e) => e.action !== "auth.login");
  assert.deepEqual(log.map((e) => [e.action, e.entity_id]), [
    ["users.created", created.id],
    ["users.updated", "u-deepa"],
    ["users.password_reset", created.id],
    ["auth.password_changed", "u-anand"],
  ]);
  assert.deepEqual(log[0].details, { email: "priya.s@example.com", roles: ["THERAPIST"] });
  assert.deepEqual(log[1].details, { changed: ["is_active"] });
  assert.ok(log.every((e) => e.user_id === "u-anand"));
});

test("the Director and Admin read the log newest first, 50 per page", () => {
  const { ctx, login, call } = setup();
  const director = login("u-revathi").data.token;
  const therapist = login("u-deepa").data.token;
  for (let i = 1; i <= 60; i += 1) {
    ctx.clock.ms += MINUTE;
    ctx.SC_Audit.log("u-anand", "test.entry", "Test", String(i), null);
  }
  const first = call("admin.audit.list", { page: 1 }, director).data;
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 50);
  assert.equal(first.total, 62);
  assert.equal(first.items.length, 50);
  assert.equal(first.items[0].entity_id, "60");
  assert.equal(call("admin.audit.list", { page: 2 }, director).data.items.length, 12);
  assert.equal(call("admin.audit.list", {}, director).data.page, 1);
  assert.equal(call("admin.audit.list", { page: 0 }, director).error.code, "INVALID_REQUEST");
  assert.equal(call("admin.audit.list", { page: 1 }, therapist).error.code, "NOT_ALLOWED");
});
