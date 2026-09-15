const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../shared/permissions.js");

test("the five roles exist", () => {
  assert.deepEqual([...P.ROLES], ["ADMIN", "THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);
});

test("capabilities follow the main spec §4 table", () => {
  assert.equal(P.can(["THERAPIST"], "application.create"), true);
  assert.equal(P.can(["DIRECTOR"], "application.create"), false);
  assert.equal(P.can(["THERAPIST"], "application.viewAll"), false);
  assert.equal(P.can(["THERAPY_HEAD"], "review.therapyHead"), true);
  assert.equal(P.can(["CENTRE_HEAD"], "review.therapyHead"), false);
  assert.equal(P.can(["DIRECTOR"], "decision.final"), true);
  assert.equal(P.can(["ADMIN"], "decision.final"), false);
  assert.equal(P.can(["ADMIN"], "users.manage"), true);
  assert.equal(P.can(["DIRECTOR"], "backups.view"), true);
  assert.equal(P.can(["DIRECTOR"], "backups.run"), false);
  assert.equal(P.can(["THERAPIST"], "reports.view"), false);
});

test("a person with two roles gets both sets of capabilities", () => {
  const roles = ["CENTRE_HEAD", "THERAPIST"];
  assert.equal(P.can(roles, "application.create"), true);
  assert.equal(P.can(roles, "review.centreHead"), true);
});

test("no roles means no capabilities", () => {
  assert.equal(P.can([], "application.create"), false);
  assert.equal(P.can(undefined, "application.create"), false);
});

test("an unknown capability is a programming error", () => {
  assert.throws(() => P.can(["ADMIN"], "application.fly"), /Unknown capability/);
});

test("therapists see only their own applications; heads see all", () => {
  const app = { createdBy: "u-priya" };
  assert.equal(P.canViewApplication({ id: "u-priya", roles: ["THERAPIST"] }, app), true);
  assert.equal(P.canViewApplication({ id: "u-deepa", roles: ["THERAPIST"] }, app), false);
  assert.equal(P.canViewApplication({ id: "u-lakshmi", roles: ["THERAPY_HEAD"] }, app), true);
});

test("only the person who filled in an application may edit it", () => {
  const app = { createdBy: "u-priya" };
  assert.equal(P.canEditApplication({ id: "u-priya", roles: ["THERAPIST"] }, app), true);
  assert.equal(P.canEditApplication({ id: "u-anand", roles: ["ADMIN"] }, app), false);
});

test("the permission tables are frozen", () => {
  assert.ok(Object.isFrozen(P.CAPABILITIES));
  assert.ok(Object.isFrozen(P.CAPABILITIES["users.manage"]));
});
