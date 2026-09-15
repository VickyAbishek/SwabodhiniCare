const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContext, plain } = require("./harness.js");

const ADMIN = { id: "u-anand", roles: ["ADMIN"] };
const THERAPIST = { id: "u-priya", roles: ["THERAPIST"] };
const SESSIONS = {
  "t-admin": { user: ADMIN },
  "t-therapist": { user: THERAPIST },
  "t-old": { error: "SESSION_EXPIRED" },
};

function setup() {
  const ctx = createContext();
  const router = ctx.SC_Api.createRouter({ resolveSession: (token) => SESSIONS[token] || null });
  return { ctx, router };
}

function post(ctx, router, body) {
  const contents = typeof body === "string" ? body : JSON.stringify(body);
  const out = ctx.SC_Api.respond({ postData: { contents, type: "text/plain" } }, router);
  return { mime: out.getMimeType(), body: JSON.parse(out.getContent()) };
}

test("broken JSON and requests without an action are invalid", () => {
  const { ctx, router } = setup();
  const res = post(ctx, router, "{not json");
  assert.equal(res.mime, "application/json");
  assert.equal(res.body.error.code, "INVALID_REQUEST");
  assert.equal(post(ctx, router, { data: {} }).body.error.code, "INVALID_REQUEST");
  assert.equal(post(ctx, router, "[1,2]").body.error.code, "INVALID_REQUEST");
  assert.equal(post(ctx, router, { action: "me.get", token: "t-admin", data: "x" }).body.error.code, "INVALID_REQUEST");
});

test("actions outside the contract, or without a handler, are unknown", () => {
  const { ctx, router } = setup();
  assert.equal(post(ctx, router, { action: "nope" }).body.error.code, "UNKNOWN_ACTION");
  assert.equal(post(ctx, router, { action: "reports.get", token: "t-admin" }).body.error.code, "UNKNOWN_ACTION");
});

test("only contract actions can be registered, once each", () => {
  const { router } = setup();
  assert.throws(() => router.register("fly.away", () => null), /not in the API contract/);
  router.register("me.get", () => null);
  assert.throws(() => router.register("me.get", () => null), /already registered/);
  assert.throws(() => router.register("me.update", "not a function"), /function/);
});

test("public actions run without signing in and get their data", () => {
  const { ctx, router } = setup();
  router.register("auth.prelogin", (data, session) => ctx.SC_Actions.ok({ email: data.email, user: session.user }));
  const res = post(ctx, router, { action: "auth.prelogin", data: { email: "a@example.com" } });
  assert.deepEqual(res.body, { ok: true, data: { email: "a@example.com", user: null }, error: null });
});

test("signed-in actions need a valid session", () => {
  const { ctx, router } = setup();
  router.register("me.get", (data, session) => ctx.SC_Actions.ok({ id: session.user.id }));
  assert.equal(post(ctx, router, { action: "me.get" }).body.error.code, "NOT_SIGNED_IN");
  assert.equal(post(ctx, router, { action: "me.get", token: "t-wrong" }).body.error.code, "NOT_SIGNED_IN");
  assert.equal(post(ctx, router, { action: "me.get", token: "t-old" }).body.error.code, "SESSION_EXPIRED");
  assert.deepEqual(post(ctx, router, { action: "me.get", token: "t-therapist" }).body.data, { id: "u-priya" });
});

test("capabilities from the contract are enforced before the handler runs", () => {
  const { ctx, router } = setup();
  let calls = 0;
  router.register("users.list", () => { calls += 1; return ctx.SC_Actions.ok([]); });
  assert.equal(post(ctx, router, { action: "users.list", token: "t-therapist" }).body.error.code, "NOT_ALLOWED");
  assert.equal(calls, 0);
  assert.equal(post(ctx, router, { action: "users.list", token: "t-admin" }).body.ok, true);
  assert.equal(calls, 1);
});

test("missing data becomes an empty object", () => {
  const { ctx, router } = setup();
  router.register("me.get", (data) => ctx.SC_Actions.ok(data));
  assert.deepEqual(post(ctx, router, { action: "me.get", token: "t-admin" }).body.data, {});
});

test("a failing handler is logged and answered with SERVER_ERROR, no details leaked", () => {
  const { ctx, router } = setup();
  router.register("me.get", () => { throw new Error("secret internals"); });
  const res = post(ctx, router, { action: "me.get", token: "t-admin" });
  assert.equal(res.body.error.code, "SERVER_ERROR");
  assert.ok(!JSON.stringify(res.body).includes("secret internals"));
  assert.equal(ctx.logs.errors.length, 1);
  assert.match(String(ctx.logs.errors[0][0]), /me\.get/);
});

test("a handler that forgets to return an envelope is a server error", () => {
  const { ctx, router } = setup();
  router.register("me.get", () => ({ id: 1 }));
  assert.equal(post(ctx, router, { action: "me.get", token: "t-admin" }).body.error.code, "SERVER_ERROR");
});

test("people with a temporary password can only change it, sign out or see their profile", () => {
  const ctx = createContext();
  const newcomer = { user: { id: "u-new", roles: ["ADMIN"], mustChangePassword: true } };
  const router = ctx.SC_Api.createRouter({ resolveSession: () => newcomer });
  for (const action of ["users.list", "me.get", "auth.changePassword", "auth.logout"]) {
    router.register(action, () => ctx.SC_Actions.ok({}));
  }
  const ask = (action) => post(ctx, router, { action, token: "t" }).body;
  assert.equal(ask("users.list").error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal(ask("me.get").ok, true);
  assert.equal(ask("auth.changePassword").ok, true);
  assert.equal(ask("auth.logout").ok, true);
});

test("the global doPost answers JSON", () => {
  const ctx = createContext();
  const out = ctx.doPost({ postData: { contents: "{", type: "text/plain" } });
  assert.equal(out.getMimeType(), "application/json");
  assert.equal(plain(JSON.parse(out.getContent())).error.code, "INVALID_REQUEST");
  assert.equal(JSON.parse(ctx.doPost({}).getContent()).error.code, "INVALID_REQUEST");
});
