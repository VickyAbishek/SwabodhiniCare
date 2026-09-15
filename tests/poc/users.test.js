const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { createContext, plain } = require("./harness.js");

const sha = (text) => nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const ADMIN_KEY = sha("admin-key");
const STAFF_KEY = sha("staff-key");
const TEMP_KEY = sha("temporary-key");
const SALT = "0123456789abcdef0123456789abcdef";
const NEW_STAFF = { email: "Priya.S@example.com", name: "Priya S", roles: ["THERAPIST"], centre: "VLC", salt: SALT, key: TEMP_KEY };

function addUser(ctx, id, email, roles, key) {
  ctx.SC_Store.insert("Users", {
    id, email, name: id, roles, password_hash: sha(key), password_salt: SALT,
    kdf_iterations: 600000, is_active: true, failed_logins: 0, must_change_password: false,
  });
}

function setup() {
  const ctx = createContext({ properties: { HMAC_SECRET: "test-secret" } });
  ctx.SC_Store.ensureTabs();
  addUser(ctx, "u-anand", "anand.k@example.com", ["ADMIN"], ADMIN_KEY);
  addUser(ctx, "u-deepa", "deepa.v@example.com", ["THERAPIST"], STAFF_KEY);
  const signIn = (email, key) => plain(ctx.SC_Api.handle({ action: "auth.login", data: { email, key } })).data;
  const admin = signIn("anand.k@example.com", ADMIN_KEY).token;
  const call = (action, data, token = admin) => plain(ctx.SC_Api.handle({ action, data, token }));
  return { ctx, call, signIn, admin };
}

test("me.get and me.update manage your own language and appearance", () => {
  const { call } = setup();
  assert.equal(call("me.get").data.name, "u-anand");
  const res = call("me.update", { preferredLang: "en", preferredTheme: "dark" });
  assert.equal(res.data.preferredLang, "en");
  assert.equal(res.data.preferredTheme, "dark");
  assert.equal(call("me.get").data.preferredTheme, "dark");
  assert.equal(call("me.update", { preferredTheme: "blue" }).error.code, "INVALID_REQUEST");
  assert.equal(call("me.update", { preferredLang: "fr" }).error.code, "INVALID_REQUEST");
});

test("the Admin creates an account that must change its temporary password", () => {
  const { call, signIn } = setup();
  const res = call("users.create", NEW_STAFF);
  assert.equal(res.ok, true);
  assert.equal(res.data.email, "priya.s@example.com");
  assert.deepEqual(res.data.roles, ["THERAPIST"]);
  assert.equal(res.data.mustChangePassword, true);
  assert.equal(res.data.isActive, true);
  const priya = signIn("priya.s@example.com", TEMP_KEY);
  assert.equal(priya.user.mustChangePassword, true);
  assert.equal(call("me.update", { preferredLang: "en" }, priya.token).error.code, "PASSWORD_CHANGE_REQUIRED");
});

test("an email can only have one account, whatever its case", () => {
  const { call } = setup();
  assert.equal(call("users.create", NEW_STAFF).ok, true);
  assert.equal(call("users.create", Object.assign({}, NEW_STAFF, { email: "PRIYA.S@EXAMPLE.COM" })).error.code, "EMAIL_TAKEN");
});

test("account details are checked", () => {
  const { call } = setup();
  const bad = (change) => call("users.create", Object.assign({}, NEW_STAFF, change)).error.code;
  assert.equal(bad({ roles: [] }), "INVALID_REQUEST");
  assert.equal(bad({ roles: ["WIZARD"] }), "INVALID_REQUEST");
  assert.equal(bad({ centre: "XYZ" }), "INVALID_REQUEST");
  assert.equal(bad({ name: " " }), "INVALID_REQUEST");
  assert.equal(bad({ email: "nope" }), "INVALID_REQUEST");
  assert.equal(bad({ salt: "short" }), "INVALID_REQUEST");
  assert.equal(bad({ key: "short" }), "INVALID_REQUEST");
  assert.equal(call("users.create", Object.assign({}, NEW_STAFF, { centre: null })).data.centre, null);
});

test("only the Admin manages accounts", () => {
  const { call, signIn } = setup();
  const deepa = signIn("deepa.v@example.com", STAFF_KEY).token;
  assert.equal(call("users.create", NEW_STAFF, deepa).error.code, "NOT_ALLOWED");
  assert.equal(call("users.list", {}, deepa).error.code, "NOT_ALLOWED");
});

test("the staff list is sorted by name and never includes password details", () => {
  const { call } = setup();
  const list = call("users.list").data;
  assert.deepEqual(list.map((u) => u.id), ["u-anand", "u-deepa"]);
  assert.ok(!JSON.stringify(list).includes("password"));
  assert.ok(!JSON.stringify(list).includes(sha(ADMIN_KEY)));
});

test("updating roles and deactivating an account, which signs it out", () => {
  const { ctx, call, signIn } = setup();
  const deepa = signIn("deepa.v@example.com", STAFF_KEY).token;
  const res = call("users.update", { id: "u-deepa", roles: ["THERAPIST", "CENTRE_HEAD"], centre: "TVM" });
  assert.deepEqual(res.data.roles, ["THERAPIST", "CENTRE_HEAD"]);
  assert.equal(res.data.centre, "TVM");
  assert.equal(call("users.update", { id: "u-deepa", isActive: false }).data.isActive, false);
  assert.equal(ctx.SC_Auth.sessionFor(deepa), null);
  assert.equal(call("users.update", { id: "u-nobody", name: "X" }).error.code, "NOT_FOUND");
  assert.equal(call("users.update", { id: "u-deepa", roles: ["WIZARD"] }).error.code, "INVALID_REQUEST");
});

test("the Admin cannot lock themselves out", () => {
  const { call } = setup();
  assert.equal(call("users.update", { id: "u-anand", isActive: false }).error.code, "NOT_ALLOWED");
  assert.equal(call("users.update", { id: "u-anand", roles: ["THERAPIST"] }).error.code, "NOT_ALLOWED");
  assert.equal(call("users.update", { id: "u-anand", roles: ["ADMIN", "DIRECTOR"] }).ok, true);
});

test("resetting a password sets a temporary one, unlocks the account and signs it out", () => {
  const { ctx, call, signIn } = setup();
  const deepa = signIn("deepa.v@example.com", STAFF_KEY).token;
  ctx.SC_Store.update("Users", "u-deepa", { locked_until: "2099-01-01T00:00:00.000Z", failed_logins: 3 });
  const res = call("users.resetPassword", { id: "u-deepa", salt: SALT, key: TEMP_KEY });
  assert.equal(res.data.mustChangePassword, true);
  assert.equal(ctx.SC_Auth.sessionFor(deepa), null);
  assert.equal(signIn("deepa.v@example.com", TEMP_KEY).user.id, "u-deepa");
  assert.equal(call("users.resetPassword", { id: "u-deepa", salt: "x", key: TEMP_KEY }).error.code, "INVALID_REQUEST");
  assert.equal(call("users.resetPassword", { id: "u-nobody", salt: SALT, key: TEMP_KEY }).error.code, "NOT_FOUND");
});
