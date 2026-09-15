const { test } = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../shared/actions.js");
const P = require("../../shared/permissions.js");

test("only prelogin and login work without signing in", () => {
  const publicActions = Object.keys(A.ACTIONS).filter((name) => A.ACTIONS[name].auth === "public");
  assert.deepEqual(publicActions.sort(), ["auth.login", "auth.prelogin"]);
});

test("every action declares auth, and every capability exists", () => {
  for (const [name, entry] of Object.entries(A.ACTIONS)) {
    assert.ok(entry.auth === "public" || entry.auth === "user", name + " has a valid auth");
    if (entry.capability) assert.ok(P.CAPABILITIES[entry.capability], name + " uses a known capability");
  }
});

test("the contract covers the POC spec §5 action list", () => {
  const expected = [
    "auth.prelogin", "auth.login", "auth.logout", "auth.changePassword", "me.get", "me.update",
    "users.list", "users.create", "users.update", "users.resetPassword",
    "applications.list", "applications.create", "applications.get", "applications.save",
    "applications.submit", "applications.review", "applications.decide", "applications.reopen",
    "applications.withdraw", "attachments.upload", "attachments.get", "attachments.delete",
    "signature.upload", "reports.get", "admin.backups.list", "admin.backups.runNow", "admin.audit.list",
  ];
  assert.deepEqual(Object.keys(A.ACTIONS).sort(), expected.sort());
});

test("every workflow error has an English and Tamil message", () => {
  const workflowErrors = ["INVALID_TRANSITION", "NOT_ALLOWED", "OWN_APPLICATION", "ALREADY_APPROVED_STAGE", "COMMENT_REQUIRED"];
  for (const code of workflowErrors) assert.ok(A.ERRORS[code], code + " is defined");
});

test("every error message exists in both languages", () => {
  for (const [code, msg] of Object.entries(A.ERRORS)) {
    assert.ok(msg.en && msg.en.trim(), code + " has English text");
    assert.ok(msg.ta && msg.ta.trim(), code + " has Tamil text");
  }
});

test("ok() and fail() build the shared envelope", () => {
  assert.deepEqual(A.ok({ id: 1 }), { ok: true, data: { id: 1 }, error: null });
  assert.deepEqual(A.ok(), { ok: true, data: null, error: null });
  const f = A.fail("VERSION_CONFLICT", { current: 8 });
  assert.equal(f.ok, false);
  assert.equal(f.data, null);
  assert.equal(f.error.code, "VERSION_CONFLICT");
  assert.equal(f.error.message_en, A.ERRORS.VERSION_CONFLICT.en);
  assert.equal(f.error.message_ta, A.ERRORS.VERSION_CONFLICT.ta);
  assert.deepEqual(f.error.details, { current: 8 });
});

test("an unknown error code becomes SERVER_ERROR", () => {
  assert.equal(A.fail("NO_SUCH_CODE").error.code, "SERVER_ERROR");
});

test("describe() returns the contract entry or null", () => {
  assert.deepEqual(A.describe("reports.get"), { auth: "user", capability: "reports.view" });
  assert.equal(A.describe("nope"), null);
});

test("the contract cannot be changed at runtime", () => {
  assert.ok(Object.isFrozen(A.ACTIONS));
  assert.ok(Object.isFrozen(A.ACTIONS["auth.login"]));
  assert.ok(Object.isFrozen(A.ERRORS));
});
