const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { createContext, plain } = require("./harness.js");

const sha = (text) => nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const KEY = sha("device-derived-key-for-priya");
const NEW_KEY = sha("device-derived-key-for-priya-new");
const SALT = "0123456789abcdef0123456789abcdef";
const NEW_SALT = "fedcba9876543210fedcba9876543210";
const EMAIL = "priya.s@example.com";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function setup(properties) {
  const ctx = createContext({ properties: Object.assign({ HMAC_SECRET: "test-secret" }, properties) });
  ctx.SC_Store.ensureTabs();
  ctx.SC_Store.insert("Users", {
    id: "u-priya", email: EMAIL, name: "Priya S", roles: ["THERAPIST"], centre: "VLC",
    password_hash: sha(KEY), password_salt: SALT, kdf_iterations: 600000,
    must_change_password: false, is_active: true, failed_logins: 0,
  });
  return ctx;
}

const call = (ctx, action, data, token) => plain(ctx.SC_Api.handle({ action, data, token }));
const login = (ctx, key = KEY, email = EMAIL) => call(ctx, "auth.login", { email, key });
const user = (ctx) => ctx.SC_Store.find("Users", "id", "u-priya");

test("prelogin returns a known user's salt, whatever the email's case", () => {
  const ctx = setup();
  assert.deepEqual(call(ctx, "auth.prelogin", { email: EMAIL }).data, { salt: SALT, iterations: 600000 });
  assert.equal(call(ctx, "auth.prelogin", { email: " Priya.S@Example.com " }).data.salt, SALT);
});

test("prelogin gives unknown emails a stable fake salt, so nobody can tell which emails exist", () => {
  const ctx = setup();
  const first = call(ctx, "auth.prelogin", { email: "nobody@example.com" }).data;
  assert.match(first.salt, /^[0-9a-f]{32}$/);
  assert.equal(first.iterations, 600000);
  assert.equal(call(ctx, "auth.prelogin", { email: "nobody@example.com" }).data.salt, first.salt);
  assert.notEqual(call(ctx, "auth.prelogin", { email: "other@example.com" }).data.salt, first.salt);
});

test("prelogin and login reject malformed input", () => {
  const ctx = setup();
  assert.equal(call(ctx, "auth.prelogin", { email: "not-an-email" }).error.code, "INVALID_REQUEST");
  assert.equal(call(ctx, "auth.prelogin", {}).error.code, "INVALID_REQUEST");
  assert.equal(login(ctx, "short").error.code, "INVALID_REQUEST");
  assert.equal(login(ctx, KEY.toUpperCase()).error.code, "INVALID_REQUEST");
});

test("a correct key signs in; only the token's hash is stored", () => {
  const ctx = setup();
  const res = login(ctx);
  assert.equal(res.ok, true);
  assert.match(res.data.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(res.data.user, {
    id: "u-priya", email: EMAIL, name: "Priya S", roles: ["THERAPIST"], centre: "VLC",
    preferredLang: "ta", preferredTheme: "light", mustChangePassword: false,
  });
  const sessions = plain(ctx.SC_Store.all("Sessions"));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token_hash, sha(res.data.token));
  assert.ok(!JSON.stringify(sessions).includes(res.data.token));
});

test("wrong keys, unknown emails and inactive accounts get the same answer", () => {
  const ctx = setup();
  assert.equal(login(ctx, NEW_KEY).error.code, "INVALID_CREDENTIALS");
  assert.equal(user(ctx).failed_logins, 1);
  assert.equal(login(ctx, KEY, "nobody@example.com").error.code, "INVALID_CREDENTIALS");
  ctx.SC_Store.update("Users", "u-priya", { is_active: false });
  assert.equal(login(ctx).error.code, "INVALID_CREDENTIALS");
});

test("five wrong keys lock the account for 15 minutes", () => {
  const ctx = setup();
  for (let i = 1; i <= 4; i += 1) assert.equal(login(ctx, NEW_KEY).error.code, "INVALID_CREDENTIALS");
  assert.equal(login(ctx, NEW_KEY).error.code, "ACCOUNT_LOCKED");
  assert.equal(login(ctx).error.code, "ACCOUNT_LOCKED");
  ctx.clock.ms += 15 * MINUTE + 1000;
  assert.equal(login(ctx).ok, true);
  assert.equal(user(ctx).failed_logins, 0);
  assert.equal(user(ctx).locked_until, null);
});

test("a session ends after 12 hours without use", () => {
  const ctx = setup();
  const { token } = login(ctx).data;
  assert.equal(ctx.SC_Auth.sessionFor(token).user.id, "u-priya");
  ctx.clock.ms += 12 * HOUR + 1000;
  assert.equal(ctx.SC_Auth.sessionFor(token).error, "SESSION_EXPIRED");
});

test("regular use keeps a session alive, but never beyond 7 days", () => {
  const ctx = setup();
  const { token } = login(ctx).data;
  for (let i = 1; i <= 15; i += 1) {
    ctx.clock.ms += 11 * HOUR;
    assert.equal(ctx.SC_Auth.sessionFor(token).user.id, "u-priya", "after " + i * 11 + " hours");
  }
  ctx.clock.ms += 11 * HOUR;
  assert.equal(ctx.SC_Auth.sessionFor(token).error, "SESSION_EXPIRED");
});

test("unknown tokens and deactivated users have no session", () => {
  const ctx = setup();
  const { token } = login(ctx).data;
  assert.equal(ctx.SC_Auth.sessionFor("f".repeat(64)), null);
  ctx.SC_Store.update("Users", "u-priya", { is_active: false });
  assert.equal(ctx.SC_Auth.sessionFor(token), null);
});

test("signing out ends the session straight away", () => {
  const ctx = setup();
  const { token } = login(ctx).data;
  assert.equal(call(ctx, "auth.logout", {}, token).ok, true);
  assert.equal(ctx.SC_Auth.sessionFor(token), null);
  assert.equal(call(ctx, "auth.logout", {}, token).error.code, "NOT_SIGNED_IN");
});

test("changing the password needs the current key and ends other sessions", () => {
  const ctx = setup();
  const phone = login(ctx).data.token;
  const desktop = login(ctx).data.token;
  const change = (data) => call(ctx, "auth.changePassword", data, phone);
  assert.equal(change({ currentKey: NEW_KEY, newSalt: NEW_SALT, newKey: NEW_KEY }).error.code, "INVALID_CREDENTIALS");
  assert.equal(change({ currentKey: KEY, newSalt: "xyz", newKey: NEW_KEY }).error.code, "INVALID_REQUEST");
  const res = change({ currentKey: KEY, newSalt: NEW_SALT, newKey: NEW_KEY });
  assert.equal(res.ok, true);
  assert.equal(res.data.mustChangePassword, false);
  assert.equal(user(ctx).password_salt, NEW_SALT);
  assert.equal(ctx.SC_Auth.sessionFor(phone).user.id, "u-priya");
  assert.equal(ctx.SC_Auth.sessionFor(desktop), null);
  assert.equal(login(ctx, KEY).error.code, "INVALID_CREDENTIALS");
  assert.equal(login(ctx, NEW_KEY).ok, true);
});

test("a missing HMAC secret is a logged server error, not a crash", () => {
  const ctx = setup({ HMAC_SECRET: "" });
  assert.equal(call(ctx, "auth.prelogin", { email: "nobody@example.com" }).error.code, "SERVER_ERROR");
  assert.match(String(ctx.logs.errors[0][0]), /HMAC_SECRET/);
});
