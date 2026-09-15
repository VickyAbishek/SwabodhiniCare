const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");
const { plain } = require("./harness.js");
const SAMPLE = require("../fixtures/sample-application.js");

const MINUTE = 60 * 1000;

function draftFor(as, name, values) {
  return as(name)("applications.create", { values }).data;
}

// An application already waiting for the Therapy Head.
function submitReady(as, who) {
  const created = draftFor(as, who, SAMPLE);
  as(who)("applications.submit", { id: created.id });
  return created;
}

test("a therapist starts a draft with the next application number", () => {
  const { as } = setupPeople();
  const first = as("priya")("applications.create", {});
  assert.equal(first.ok, true);
  assert.equal(first.data.appNo, "APP-2026-0001");
  assert.equal(first.data.status, "DRAFT");
  assert.equal(first.data.version, 1);
  assert.equal(first.data.createdBy, "u-priya");
  assert.deepEqual(first.data.values, {});
  assert.equal(as("deepa")("applications.create", {}).data.appNo, "APP-2026-0002");
});

test("starting answers are checked and summarised", () => {
  const { ctx, as } = setupPeople();
  const res = as("priya")("applications.create", { values: { s1_centre: "VLC", s2_full_name: "Arjun Karthik" } });
  assert.equal(res.data.centre, "VLC");
  assert.equal(res.data.applicantName, "Arjun Karthik");
  const bad = as("priya")("applications.create", { values: { s3_primary_phone: "123" } });
  assert.equal(bad.error.code, "VALIDATION_FAILED");
  assert.deepEqual(bad.error.details, { errors: { s3_primary_phone: "INVALID_PHONE" } });
  assert.equal(ctx.SC_Store.all("Applications").length, 1);
});

test("only roles that fill in forms can start one", () => {
  const { as } = setupPeople();
  assert.equal(as("revathi")("applications.create", {}).error.code, "NOT_ALLOWED");
  assert.equal(as("priya")("applications.create", { values: "x" }).error.code, "INVALID_REQUEST");
});

test("the author and the heads can open it; other therapists can't tell it exists", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", SAMPLE);
  const own = as("priya")("applications.get", { id });
  assert.deepEqual(own.data.values, plain(SAMPLE));
  assert.equal(own.data.completion.done, 11);
  assert.deepEqual(own.data.safetyFlags, ["s7_wandering"]);
  assert.equal(as("lakshmi")("applications.get", { id }).ok, true);
  assert.equal(as("deepa")("applications.get", { id }).error.code, "NOT_FOUND");
  assert.equal(as("priya")("applications.get", { id: "nope" }).error.code, "NOT_FOUND");
  assert.equal(as("priya")("applications.get", {}).error.code, "INVALID_REQUEST");
});

test("saving merges answers, clears nulls, refreshes the summary and bumps the version", () => {
  const { as } = setupPeople();
  const created = draftFor(as, "priya", { s1_centre: "VLC", s2_name_ta: "அர்ஜுன்" });
  const saved = as("priya")("applications.save", {
    id: created.id, version: 1, values: { s2_full_name: "Arjun Karthik", s2_name_ta: null, s1_programs: ["YOGA"] },
  });
  assert.equal(saved.data.version, 2);
  assert.deepEqual(saved.data.values, { s1_centre: "VLC", s2_full_name: "Arjun Karthik", s1_programs: ["YOGA"] });
  assert.equal(saved.data.applicantName, "Arjun Karthik");
  assert.equal(as("priya")("applications.get", { id: created.id }).data.version, 2);
});

test("a save from an out-of-date copy is refused, so nobody overwrites anyone", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  assert.equal(as("priya")("applications.save", { id, version: 1, values: { s2_full_name: "First" } }).ok, true);
  const stale = as("priya")("applications.save", { id, version: 1, values: { s2_full_name: "Second" } });
  assert.equal(stale.error.code, "VERSION_CONFLICT");
  assert.deepEqual(stale.error.details, { current: 2 });
  assert.equal(as("priya")("applications.get", { id }).data.values.s2_full_name, "First");
});

test("answers are checked when saving", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  const save = (data) => as("priya")("applications.save", Object.assign({ id, version: 1 }, data));
  assert.deepEqual(save({ values: { s3_primary_phone: "123" } }).error.details, { errors: { s3_primary_phone: "INVALID_PHONE" } });
  assert.deepEqual(save({ values: { s2_aadhaar_number: "1" } }).error.details, { errors: { s2_aadhaar_number: "UNKNOWN_FIELD" } });
  assert.equal(save({ version: "1", values: {} }).error.code, "INVALID_REQUEST");
  assert.equal(save({ values: [] }).error.code, "INVALID_REQUEST");
});

test("only the author can save, and only while it is a draft or sent back", () => {
  const { ctx, as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  const save = (name, version) => as(name)("applications.save", { id, version, values: { s2_full_name: "X" } });
  assert.equal(save("lakshmi", 1).error.code, "NOT_ALLOWED");
  assert.equal(save("deepa", 1).error.code, "NOT_FOUND");
  ctx.SC_Store.update("Applications", id, { status: "PENDING_THERAPY_HEAD" });
  assert.equal(save("priya", 1).error.code, "NOT_ALLOWED");
  ctx.SC_Store.update("Applications", id, { status: "RETURNED" });
  assert.equal(save("priya", 1).ok, true);
});

test("the list shows therapists their own applications and heads everything, newest first", () => {
  const { ctx, as } = setupPeople();
  const arjun = draftFor(as, "priya", { s2_full_name: "Arjun Karthik" });
  const meena = draftFor(as, "deepa", { s2_full_name: "Meenakshi R" });
  ctx.clock.ms += MINUTE;
  as("priya")("applications.save", { id: arjun.id, version: 1, values: { s1_centre: "VLC" } });
  const mine = as("priya")("applications.list", {}).data;
  assert.deepEqual(mine.items.map((a) => a.appNo), ["APP-2026-0001"]);
  const all = as("lakshmi")("applications.list", {}).data;
  assert.deepEqual(all.items.map((a) => a.id), [arjun.id, meena.id]);
  assert.deepEqual([all.page, all.pageSize, all.total], [1, 50, 2]);
  assert.deepEqual(Object.keys(all.items[0]).sort(), ["appNo", "applicantName", "centre", "createdBy", "id", "safetyFlags", "status", "updatedAt"]);
  assert.deepEqual(as("lakshmi")("applications.list", { q: "meena" }).data.items.map((a) => a.id), [meena.id]);
  assert.deepEqual(as("lakshmi")("applications.list", { q: "app-2026-0002" }).data.items.map((a) => a.id), [meena.id]);
  assert.equal(as("lakshmi")("applications.list", { status: "RETURNED" }).data.total, 0);
  assert.equal(as("lakshmi")("applications.list", { centre: "VLC" }).data.total, 1);
  assert.equal(as("lakshmi")("applications.list", { page: 0 }).error.code, "INVALID_REQUEST");
});

test("the form fingerprint follows the answers and nothing else", () => {
  const { ctx, as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  const row = () => ctx.SC_Store.find("Applications", "id", id);

  const first = ctx.SC_Applications.formHash(row());
  assert.match(first, /^[0-9a-f]{64}$/);

  as("priya")("applications.save", { id, version: 1, values: { s2_full_name: "Nila M" } });
  const changed = ctx.SC_Applications.formHash(row());
  assert.notEqual(changed, first, "an answer change must change the fingerprint");

  const again = ctx.SC_Applications.formHash(row());
  assert.equal(again, changed, "the same answers must give the same fingerprint");
});

test("creating, viewing by others and saving are recorded in the audit log", () => {
  const { ctx, as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  as("lakshmi")("applications.get", { id });
  as("priya")("applications.get", { id });
  as("priya")("applications.save", { id, version: 1, values: { s2_full_name: "Arjun" } });
  const log = plain(ctx.SC_Store.all("Audit")).filter((e) => e.action.startsWith("applications."));
  assert.deepEqual(log.map((e) => [e.action, e.user_id]), [
    ["applications.created", "u-priya"],
    ["applications.viewed", "u-lakshmi"],
    ["applications.saved", "u-priya"],
  ]);
  assert.deepEqual(log[2].details, { fields: ["s2_full_name"] });
  assert.ok(log.every((e) => e.entity === "Applications" && e.entity_id === id));
});

test("only the owner can send an application for review", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  const result = as("lakshmi")("applications.submit", { id });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_ALLOWED");
});

test("sending for review needs every answer the submit check wants", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {}); // a draft holding nothing
  const result = as("priya")("applications.submit", { id });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
  assert.ok(Object.keys(result.error.details.errors).length > 0);
});

test("the owner sends a complete application and it reaches the Therapy Head", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  const shown = as("lakshmi")("applications.get", { id }).data;
  assert.equal(shown.status, "PENDING_THERAPY_HEAD");
  assert.ok(shown.submittedAt, "submitting must stamp the time");
});

test("a sent application cannot be sent again", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  const result = as("priya")("applications.submit", { id });
  assert.equal(result.error.code, "INVALID_TRANSITION");
});

test("the owning therapist withdraws a draft; another therapist cannot", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  assert.equal(as("deepa")("applications.withdraw", { id }).error.code, "NOT_FOUND");
  assert.equal(as("priya")("applications.withdraw", { id }).data.status, "WITHDRAWN");
});

test("an Admin can withdraw on the family's behalf, but not once it is with a reviewer", () => {
  const { as } = setupPeople();
  const draft = draftFor(as, "priya", {});
  assert.equal(as("anand")("applications.withdraw", { id: draft.id }).data.status, "WITHDRAWN");

  const sent = submitReady(as, "priya");
  assert.equal(as("anand")("applications.withdraw", { id: sent.id }).error.code, "INVALID_TRANSITION");
});

test("a withdrawn application cannot be sent for review", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  as("priya")("applications.withdraw", { id });
  assert.equal(as("priya")("applications.submit", { id }).error.code, "INVALID_TRANSITION");
});
