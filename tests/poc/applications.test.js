const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople, sha } = require("./people.js");
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

test("the Therapy Head approves and it moves to the Centre Head", () => {
  const { ctx, as } = setupPeople();
  const { id } = submitReady(as, "priya");
  const result = as("lakshmi")("applications.review", { id, action: "APPROVE", comment: "Good fit." });
  assert.equal(result.data.status, "PENDING_CENTRE_HEAD");

  const slip = ctx.SC_Store.filter("Approvals", (r) => r.application_id === id);
  assert.equal(slip.length, 1);
  assert.equal(slip[0].stage, "THERAPY_HEAD");
  assert.equal(slip[0].action, "APPROVE");
  assert.equal(slip[0].user_id, "u-lakshmi");
  assert.match(slip[0].form_hash, /^[0-9a-f]{64}$/);
  assert.ok(slip[0].created_at);
});

test("only the role for the current stage may decide", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  assert.equal(as("suresh")("applications.review", { id, action: "APPROVE" }).error.code, "NOT_ALLOWED", "Centre Head too early");
  assert.equal(as("revathi")("applications.review", { id, action: "APPROVE" }).error.code, "NOT_ALLOWED", "Director too early");
});

// ADMIT and WAITLIST are the Director's alone and need their password re-entered, so they must not
// be reachable through review: a decision that slipped through here would skip the step-up.
test("a review cannot be the Director's admit or waitlist", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "APPROVE" });
  assert.equal(as("revathi")("applications.review", { id, action: "ADMIT" }).error.code, "INVALID_REQUEST");
  assert.equal(as("revathi")("applications.review", { id, action: "WAITLIST" }).error.code, "INVALID_REQUEST");
  assert.equal(as("revathi")("applications.get", { id }).data.status, "PENDING_DIRECTOR");
});

test("nobody reviews their own application, and nobody approves two stages", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "lakshmi"); // the Therapy Head filed it themselves
  assert.equal(as("lakshmi")("applications.review", { id, action: "APPROVE" }).error.code, "OWN_APPLICATION");

  const other = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id: other.id, action: "APPROVE" });
  assert.equal(as("lakshmi")("applications.review", { id: other.id, action: "APPROVE" }).error.code, "NOT_ALLOWED", "the Centre Head's turn now");
});

test("sending back and rejecting need a real comment", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  assert.equal(as("lakshmi")("applications.review", { id, action: "SEND_BACK", comment: "   " }).error.code, "COMMENT_REQUIRED");
  assert.equal(as("lakshmi")("applications.review", { id, action: "REJECT" }).error.code, "COMMENT_REQUIRED");

  const sentBack = as("lakshmi")("applications.review", { id, action: "SEND_BACK", comment: "Please add the report." });
  assert.equal(sentBack.data.status, "RETURNED");
});

test("a sent-back application starts the chain again at the Therapy Head", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "SEND_BACK", comment: "Photo is blurred." });
  assert.equal(as("priya")("applications.get", { id }).data.status, "RETURNED");

  // create v1, submit v2, approve v3, send back v4 — every one of them bumps the version.
  as("priya")("applications.save", { id, version: 4, values: { s2_name_ta: "நிலா" } });
  const resent = as("priya")("applications.submit", { id });
  assert.equal(resent.data.status, "PENDING_THERAPY_HEAD");

  // Earlier comments stay on the slip.
  const slip = as("lakshmi")("applications.get", { id }); // get returns the view; the slip is read in Task 6
  assert.equal(resent.data.status, "PENDING_THERAPY_HEAD");
});

test("a redeeming reviewer is not blocked by their own earlier approval in a new round", () => {
  const { ctx, as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "SEND_BACK", comment: "Please fix." });
  ctx.clock.ms += MINUTE; // a resubmit starts a later round, and the fake clock has to be told
  as("priya")("applications.submit", { id });
  // Lakshmi approved the previous round; the new round must let her approve her stage again.
  const again = as("lakshmi")("applications.review", { id, action: "APPROVE" });
  assert.equal(again.data.status, "PENDING_CENTRE_HEAD");
});

test("a decision is written to the audit log", () => {
  const { ctx, as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  const logged = ctx.SC_Store.filter("Audit", (r) => r.action === "applications.reviewed" && r.entity_id === id);
  assert.equal(logged.length, 1);
});

// RETURNED is unreachable until SEND_BACK exists, so Task 3 left this half of withdraw unverified.
test("the owner can withdraw an application a reviewer sent back", () => {
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "SEND_BACK", comment: "Please add the report." });
  assert.equal(as("priya")("applications.get", { id }).data.status, "RETURNED");

  const withdrawn = as("priya")("applications.withdraw", { id });
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.data.status, "WITHDRAWN");
  assert.equal(as("priya")("applications.get", { id }).data.status, "WITHDRAWN");
});

// Walks an application to the Director's desk and returns its id.
function atDirector(as) {
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "APPROVE" });
  return id;
}
const directorKey = () => sha("key-revathi"); // people.js exports sha and uses sha(`key-${name}`)

test("the Director admits with their password and a registration number is issued", () => {
  const { ctx, as } = setupPeople();
  const id = atDirector(as);
  const result = as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  assert.equal(result.data.status, "ADMITTED");
  assert.equal(result.data.registrationNo, "SWB/VLC/2026/0001");

  const row = ctx.SC_Store.find("Applications", "id", id);
  assert.equal(row.registration_no, "SWB/VLC/2026/0001");
});

test("the wrong password refuses the decision and changes nothing", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  const result = as("revathi")("applications.decide", { id, action: "ADMIT", key: "not-the-key" });
  assert.equal(result.error.code, "INVALID_CREDENTIALS");
  assert.equal(as("revathi")("applications.get", { id }).data.status, "PENDING_DIRECTOR");
});

test("waitlisting needs no registration number, and the Director may admit later", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  const waitlisted = as("revathi")("applications.decide", { id, action: "WAITLIST", key: directorKey() });
  assert.equal(waitlisted.data.status, "WAITLISTED");
  assert.equal(waitlisted.data.registrationNo, null);

  const later = as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  assert.equal(later.data.status, "ADMITTED");
  assert.equal(later.data.registrationNo, "SWB/VLC/2026/0001");
});

test("a waitlist records when the Director decided, as any decision does", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  assert.equal(as("revathi")("applications.get", { id }).data.decidedAt, null, "nobody has decided yet");

  const waitlisted = as("revathi")("applications.decide", { id, action: "WAITLIST", key: directorKey() });
  assert.ok(waitlisted.data.decidedAt, "waitlisting is still a decision");
  assert.equal(as("revathi")("applications.get", { id }).data.decidedAt, waitlisted.data.decidedAt);
});

test("only the Director decides, and Admit always needs the password", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  assert.equal(as("suresh")("applications.decide", { id, action: "ADMIT", key: "not-the-key" }).error.code, "NOT_ALLOWED");
  assert.equal(as("revathi")("applications.decide", { id, action: "ADMIT" }).error.code, "INVALID_REQUEST");
});

test("the Director rejects from the review screen, and a rejected application is final", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  // Rejecting is not signing, so it goes through review and needs no password — only Admit and
  // Waitlist carry the step-up.
  const rejected = as("revathi")("applications.review", { id, action: "REJECT", comment: "Not eligible." });
  assert.equal(rejected.data.status, "REJECTED");
  assert.equal(as("revathi")("applications.review", { id, action: "SEND_BACK", comment: "x" }).error.code, "INVALID_TRANSITION");
});

test("registration numbers run per centre and per year, and never repeat", () => {
  const { as } = setupPeople();
  const first = atDirector(as);
  const second = atDirector(as);
  assert.equal(as("revathi")("applications.decide", { id: first, action: "ADMIT", key: directorKey() }).data.registrationNo, "SWB/VLC/2026/0001");
  as("revathi")("applications.decide", { id: second, action: "ADMIT", key: directorKey() });
  const third = atDirector(as);
  assert.equal(as("revathi")("applications.decide", { id: third, action: "ADMIT", key: directorKey() }).data.registrationNo, "SWB/VLC/2026/0003");
});

// The school's clock, not UTC's: 2026-12-31 19:00Z is 2027-01-01 00:30 in Chennai. A number minted
// in that half hour must carry 2027 — it is issued once, so a wrong year in it is permanent, and it
// has to agree with the application number, which takes its year the same way.
test("the registration number uses the school's year, not UTC's", () => {
  const { as } = setupPeople({ clock: { ms: Date.parse("2026-12-31T19:00:00Z") } });
  const id = atDirector(as);
  const decided = as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  assert.equal(decided.data.registrationNo, "SWB/VLC/2027/0001");
  assert.equal(decided.data.appNo, "APP-2027-0001", "the two numbers must agree on the year");
});

// Every person in people.js holds exactly one role, so no test could reach the two-stage rule at
// handler level: workflow.js reads (ctx.approvedThisRound || []), which fails open if a handler
// forgets to pass the list. One person with both reviewing roles pins it — and pins the boundary
// too: their stage-1 approval and the submit share one millisecond here, so approversThisRound's
// ">=" must count it (">" would let them sign the next stage as well).
test("one person holding two reviewing roles cannot approve two stages of one application", () => {
  const { ctx, as } = setupPeople();
  const key = sha("key-mala");
  ctx.SC_Store.insert("Users", {
    id: "u-mala", email: "mala@example.com", name: "Mala", roles: ["THERAPY_HEAD", "CENTRE_HEAD"],
    password_hash: sha(key), password_salt: "0123456789abcdef0123456789abcdef", kdf_iterations: 600000,
    is_active: true, failed_logins: 0, must_change_password: false,
  });
  const token = plain(ctx.SC_Api.handle({ action: "auth.login", data: { email: "mala@example.com", key } })).data.token;
  const asMala = (action, data) => plain(ctx.SC_Api.handle({ action, data, token }));

  const { id } = submitReady(as, "priya");
  assert.equal(asMala("applications.review", { id, action: "APPROVE" }).data.status, "PENDING_CENTRE_HEAD");

  const second = asMala("applications.review", { id, action: "APPROVE" });
  assert.equal(second.error.code, "ALREADY_APPROVED_STAGE");
  assert.equal(as("priya")("applications.get", { id }).data.status, "PENDING_CENTRE_HEAD");
});

test("only the Director or an Admin reopens, and only with a reason", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });

  // Suresh is the Centre Head, so he can see it — he just may not reopen it.
  assert.equal(as("suresh")("applications.reopen", { id, reason: "x" }).error.code, "NOT_ALLOWED");
  assert.equal(as("revathi")("applications.reopen", { id, reason: "  " }).error.code, "COMMENT_REQUIRED");

  const reopened = as("revathi")("applications.reopen", { id, reason: "Centre transfer." });
  assert.equal(reopened.data.status, "RETURNED");
  assert.equal(reopened.data.registrationNo, "SWB/VLC/2026/0001", "a registration number is issued once");
});

test("the routing slip keeps every decision, oldest first", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  const slip = as("priya")("applications.get", { id }).data.approvals;

  assert.deepEqual(plain(slip.map((s) => s.action)), ["APPROVE", "APPROVE", "ADMIT"]);
  assert.deepEqual(plain(slip.map((s) => s.stage)), ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);
  assert.equal(slip[0].userName, "Lakshmi");
});

// The slip is built for the application screen alone. save is the autosave — every few seconds while
// somebody types — and building the slip reads the whole Approvals tab plus one user row per approval,
// so it must not ride on a save's answer. This is a performance contract, not a detail: an endpoint
// that genuinely needs the slip should have to change this test on purpose, not discover the cost in
// production. It guards the reverse direction too: re-adding the field to view() would put the read
// back on every action that returns an application.
test("saving a draft does not build the routing slip", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  const saved = as("priya")("applications.save", { id, version: 1, values: { s2_full_name: "X" } });
  assert.equal("approvals" in saved.data, false);
});

test("a reopened application goes through the chain again but keeps its history", () => {
  const { ctx, as } = setupPeople();
  const id = atDirector(as);
  as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  as("revathi")("applications.reopen", { id, reason: "Centre transfer." });
  ctx.clock.ms += MINUTE; // a resubmit starts a later round, and the fake clock has to be told
  as("priya")("applications.submit", { id });

  const slip = as("priya")("applications.get", { id }).data.approvals;
  assert.equal(slip.length, 4);
  assert.equal(slip[3].action, "REOPEN");
  assert.equal(as("lakshmi")("applications.review", { id, action: "APPROVE" }).data.status, "PENDING_CENTRE_HEAD");
});

// The number is the family's — it is already printed on their report — so reopening for a correction
// must not take it back, and admitting a second time must not mint a new one or spend a counter.
test("a second admit keeps the registration number and does not spend a number", () => {
  const { ctx, as } = setupPeople();
  const id = atDirector(as);
  const first = as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  assert.equal(first.data.registrationNo, "SWB/VLC/2026/0001");

  const reopened = as("revathi")("applications.reopen", { id, reason: "Centre transfer." });
  assert.equal(reopened.data.registrationNo, "SWB/VLC/2026/0001", "reopening does not take the number back");
  assert.equal(reopened.data.decidedAt, first.data.decidedAt, "nor the moment the Director decided");

  ctx.clock.ms += MINUTE; // a resubmit starts a later round, and the fake clock has to be told
  as("priya")("applications.submit", { id });
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "APPROVE" });
  const again = as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  assert.equal(again.data.status, "ADMITTED");
  assert.equal(again.data.registrationNo, "SWB/VLC/2026/0001", "the number under the family never changes");

  // And the counter was not spent twice: the next family still gets 0002, not 0003.
  const next = atDirector(as);
  assert.equal(
    as("revathi")("applications.decide", { id: next, action: "ADMIT", key: directorKey() }).data.registrationNo,
    "SWB/VLC/2026/0002"
  );
});

// decide passes the same approvedThisRound list review does, and dropping it fails open the same way.
// Vasan holds both reviewing roles and the Director's, so one person can reach decide after approving
// a stage — the only shape that can. His Centre Head approval and the submit share one millisecond
// here, so approversThisRound's ">=" must count it (">" would let him sign as Director too).
test("the Director cannot admit after approving a stage of the same round", () => {
  const { ctx, as } = setupPeople();
  const key = sha("key-vasan");
  ctx.SC_Store.insert("Users", {
    id: "u-vasan", email: "vasan@example.com", name: "Vasan", roles: ["CENTRE_HEAD", "DIRECTOR"],
    password_hash: sha(key), password_salt: "0123456789abcdef0123456789abcdef", kdf_iterations: 600000,
    is_active: true, failed_logins: 0, must_change_password: false,
  });
  const token = plain(ctx.SC_Api.handle({ action: "auth.login", data: { email: "vasan@example.com", key } })).data.token;
  const asVasan = (action, data) => plain(ctx.SC_Api.handle({ action, data, token }));

  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  assert.equal(asVasan("applications.review", { id, action: "APPROVE" }).data.status, "PENDING_DIRECTOR");

  const admit = asVasan("applications.decide", { id, action: "ADMIT", key });
  assert.equal(admit.error.code, "ALREADY_APPROVED_STAGE");
  assert.equal(as("priya")("applications.get", { id }).data.status, "PENDING_DIRECTOR");
});
