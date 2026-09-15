import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createRoutingSlip } from "../../public/js/routing-slip.js";

const require = createRequire(import.meta.url);
const workflow = require("../../shared/workflow.js");

// The screen hands the model its own translator and date formatter, so the tests hand it stand-ins
// that spell out which key was used and which date went into it. No DOM is involved anywhere here.
const t = (key, vars) => (vars && vars.date ? `${key}@${vars.date}` : key);
const formatDate = (iso) => String(iso).slice(0, 10);
const slip = createRoutingSlip({ workflow, t, formatDate });

const at = (stage, action, userName, when, comment) => ({
  stage, action, userName, at: when, comment: comment === undefined ? null : comment,
});
const states = (rows) => rows.map((row) => row.state);

test("the track puts a waiting application at its step of the four-step route", () => {
  const track = (status) => {
    const { step, total, label } = slip.track(status);
    return [step, total, label];
  };
  assert.deepEqual(track("DRAFT"), [1, 4, "THERAPIST"]);
  assert.deepEqual(track("RETURNED"), [1, 4, "THERAPIST"], "a sent-back file is being worked on again");
  assert.deepEqual(track("PENDING_THERAPY_HEAD"), [2, 4, "THERAPY_HEAD"]);
  assert.deepEqual(track("PENDING_CENTRE_HEAD"), [3, 4, "CENTRE_HEAD"]);
  assert.deepEqual(track("PENDING_DIRECTOR"), [4, 4, "DIRECTOR"]);
});

test("a finished route shows its last step, and a withdrawn file rests at the first", () => {
  assert.equal(slip.track("ADMITTED").step, 4, "the Director decided");
  assert.equal(slip.track("WAITLISTED").step, 4, "the Director can still admit a waitlisted file");
  assert.equal(slip.track("REJECTED").step, 1, "out of the route, back on the therapist's desk");
  assert.equal(slip.track("WITHDRAWN").step, 1);
});

// The step comes from the workflow's own reviewer table, so a change to who reviews what cannot
// leave this component pointing at the wrong stage.
test("the track and the workflow agree on who holds a waiting application", () => {
  for (const status of ["PENDING_THERAPY_HEAD", "PENDING_CENTRE_HEAD", "PENDING_DIRECTOR", "WAITLISTED"]) {
    assert.equal(slip.track(status).label, workflow.reviewerRole(status), status);
  }
});

test("a status the route does not know is refused rather than guessed at", () => {
  assert.throws(() => slip.track("HALF_WAY"), /HALF_WAY/);
  assert.throws(() => slip.track(undefined), /undefined/);
});

test("the slip marks each step done, now or still to come", () => {
  const rows = slip.slip({
    status: "PENDING_CENTRE_HEAD",
    submittedAt: "2026-09-12T09:00:00Z",
    approvals: [at("THERAPY_HEAD", "APPROVE", "Lakshmi", "2026-09-13T09:00:00Z")],
    names: { THERAPIST: "Priya" },
  });
  assert.deepEqual(rows.map((row) => [row.stage, row.state]), [
    ["THERAPIST", "done"],
    ["THERAPY_HEAD", "done"],
    ["CENTRE_HEAD", "now"],
    ["DIRECTOR", "todo"],
  ]);
});

test("the slip names the people, dates what they did and keeps what they said", () => {
  const rows = slip.slip({
    status: "PENDING_CENTRE_HEAD",
    submittedAt: "2026-09-12T09:00:00Z",
    approvals: [at("THERAPY_HEAD", "APPROVE", "Lakshmi", "2026-09-13T09:00:00Z", "Good fit for the morning batch.")],
    names: { THERAPIST: "Priya", CENTRE_HEAD: "You" },
  });
  assert.deepEqual(rows.map((row) => row.name), ["Priya", "Lakshmi", "You", ""]);
  assert.deepEqual(rows.map((row) => row.meta), [
    "slip.sent@2026-09-12",
    "slip.approved@2026-09-13",
    "slip.waitingSince@2026-09-13",
    "slip.notYet",
  ]);
  assert.deepEqual(rows.map((row) => row.comment), [null, "Good fit for the morning batch.", null, null]);
});

test("a draft's first step is the therapist's own, dated when it was last filled in", () => {
  const rows = slip.slip({ status: "DRAFT", filledInAt: "2026-09-15T09:00:00Z", names: { THERAPIST: "You" } });
  assert.deepEqual(states(rows), ["now", "todo", "todo", "todo"]);
  assert.deepEqual(rows.map((row) => row.meta), [
    "slip.filledIn@2026-09-15", "slip.notYet", "slip.notYet", "slip.notYet",
  ]);
  assert.equal(rows[0].name, "You", "the therapist's own file says You, not their name");
});

// Any reviewer can send a file back, and it always starts again at the therapist, so the step it
// came from is ahead of the file once more — but what that reviewer said stays on the slip.
test("a sent-back file hands step 1 back and keeps the reviewer's comment", () => {
  const rows = slip.slip({
    status: "RETURNED",
    submittedAt: "2026-09-12T09:00:00Z",
    approvals: [at("THERAPY_HEAD", "SEND_BACK", "Lakshmi", "2026-09-13T09:00:00Z", "Attach the last page.")],
    names: { THERAPIST: "Priya" },
  });
  assert.deepEqual(states(rows), ["now", "todo", "todo", "todo"]);
  assert.equal(rows[0].meta, "slip.sent@2026-09-12", "it was filled in and sent on that day");
  assert.equal(rows[1].comment, "Attach the last page.");
});

test("the slip carries no approval text once a stage has never been reached", () => {
  const rows = slip.slip({ status: "PENDING_THERAPY_HEAD", submittedAt: "2026-09-12T09:00:00Z" });
  assert.deepEqual(states(rows), ["done", "now", "todo", "todo"]);
  assert.equal(rows[1].meta, "slip.waitingSince@2026-09-12", "waiting on the Therapy Head since it was sent");
  assert.deepEqual(rows.map((row) => row.comment), [null, null, null, null]);
});

// A stage can act more than once (an approve, a send back, then another approval after a resubmit):
// the slip shows where the file is, so it carries the latest word from that stage.
test("a stage that acted twice shows its latest word", () => {
  const rows = slip.slip({
    status: "PENDING_CENTRE_HEAD",
    submittedAt: "2026-09-12T09:00:00Z",
    approvals: [
      at("THERAPY_HEAD", "SEND_BACK", "Lakshmi", "2026-09-12T12:00:00Z", "Something is missing."),
      at("THERAPY_HEAD", "APPROVE", "Lakshmi", "2026-09-14T09:00:00Z", "All there now."),
    ],
  });
  assert.equal(rows[1].state, "done");
  assert.equal(rows[1].meta, "slip.approved@2026-09-14");
  assert.equal(rows[1].comment, "All there now.");
});

test("the slip is exactly four steps, whatever else the file has been through", () => {
  const rows = slip.slip({
    status: "ADMITTED",
    submittedAt: "2026-09-12T09:00:00Z",
    approvals: [
      at("THERAPY_HEAD", "APPROVE", "Lakshmi", "2026-09-12T12:00:00Z"),
      at("CENTRE_HEAD", "APPROVE", "Suresh", "2026-09-13T12:00:00Z"),
      at("DIRECTOR", "ADMIT", "Revathi", "2026-09-14T12:00:00Z"),
    ],
  });
  assert.deepEqual(rows.map((row) => row.stage), ["THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);
  assert.deepEqual(states(rows), ["done", "done", "done", "now"]);
  assert.equal(rows[3].meta, "slip.approved@2026-09-14");
});
