const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../shared/workflow.js");

const S = W.STATUS;
const owner = { actorId: "u-priya", actorRoles: ["THERAPIST"], createdBy: "u-priya" };
const actor = (id, roles, extra) =>
  Object.assign({ actorId: id, actorRoles: roles, createdBy: "u-priya", approvedThisRound: [] }, extra);
const therapyHead = (extra) => actor("u-lakshmi", ["THERAPY_HEAD"], extra);
const centreHead = (extra) => actor("u-suresh", ["CENTRE_HEAD"], Object.assign({ approvedThisRound: ["u-lakshmi"] }, extra));
const director = (extra) =>
  actor("u-revathi", ["DIRECTOR"], Object.assign({ approvedThisRound: ["u-lakshmi", "u-suresh"] }, extra));

test("main path: draft to admitted", () => {
  assert.equal(W.next(S.DRAFT, "SUBMIT", owner).status, S.PENDING_THERAPY_HEAD);
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", therapyHead()).status, S.PENDING_CENTRE_HEAD);
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "APPROVE", centreHead()).status, S.PENDING_DIRECTOR);
  assert.equal(W.next(S.PENDING_DIRECTOR, "ADMIT", director()).status, S.ADMITTED);
});

test("any reviewer can send back; resubmitting restarts at the Therapy Head", () => {
  const comment = { comment: "Please add the diagnosis report." };
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "SEND_BACK", therapyHead(comment)).status, S.RETURNED);
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "SEND_BACK", centreHead(comment)).status, S.RETURNED);
  assert.equal(W.next(S.PENDING_DIRECTOR, "SEND_BACK", director(comment)).status, S.RETURNED);
  assert.equal(W.next(S.RETURNED, "SUBMIT", owner).status, S.PENDING_THERAPY_HEAD);
});

test("send back and reject need a real comment", () => {
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "SEND_BACK", centreHead()).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "REJECT", centreHead({ comment: "   " })).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "REJECT", centreHead({ comment: "No seat." })).status, S.REJECTED);
});

test("rejected and withdrawn applications cannot move again", () => {
  assert.equal(W.next(S.REJECTED, "SUBMIT", owner).error, "INVALID_TRANSITION");
  assert.equal(W.next(S.WITHDRAWN, "SUBMIT", owner).error, "INVALID_TRANSITION");
});

test("waitlisted applications can be admitted later by the Director", () => {
  assert.equal(W.next(S.PENDING_DIRECTOR, "WAITLIST", director()).status, S.WAITLISTED);
  assert.equal(W.next(S.WAITLISTED, "ADMIT", director()).status, S.ADMITTED);
});

test("only the role for the current stage can decide", () => {
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-suresh", ["CENTRE_HEAD"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-anand", ["ADMIN"])).error, "NOT_ALLOWED");
});

test("nobody reviews an application they filled in", () => {
  const selfReview = actor("u-lakshmi", ["THERAPY_HEAD"], { createdBy: "u-lakshmi" });
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", selfReview).error, "OWN_APPLICATION");
});

test("one person cannot approve two stages in the same round", () => {
  const both = actor("u-mala", ["THERAPY_HEAD", "CENTRE_HEAD"], { approvedThisRound: ["u-mala"] });
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "APPROVE", both).error, "ALREADY_APPROVED_STAGE");
});

test("only the owner submits; the owner or Admin withdraws", () => {
  assert.equal(W.next(S.DRAFT, "SUBMIT", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.DRAFT, "WITHDRAW", owner).status, S.WITHDRAWN);
  assert.equal(W.next(S.RETURNED, "WITHDRAW", actor("u-anand", ["ADMIN"])).status, S.WITHDRAWN);
  assert.equal(W.next(S.DRAFT, "WITHDRAW", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
});

test("reopening needs the Director or Admin and a reason", () => {
  assert.equal(W.next(S.ADMITTED, "REOPEN", actor("u-anand", ["ADMIN"], { comment: "Wrong DOB." })).status, S.RETURNED);
  assert.equal(W.next(S.ADMITTED, "REOPEN", actor("u-anand", ["ADMIN"])).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.ADMITTED, "REOPEN", therapyHead({ comment: "x" })).error, "NOT_ALLOWED");
});

test("a person without permission is told so before being asked for a comment", () => {
  assert.equal(W.next(S.PENDING_DIRECTOR, "REJECT", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
});

test("unknown statuses and actions are invalid transitions", () => {
  assert.equal(W.next("FLYING", "SUBMIT", owner).error, "INVALID_TRANSITION");
  assert.equal(W.next(S.DRAFT, "FLY", owner).error, "INVALID_TRANSITION");
});

test("availableActions lists the buttons each person sees", () => {
  assert.deepEqual(W.availableActions(S.DRAFT, owner), ["SUBMIT", "WITHDRAW"]);
  assert.deepEqual(W.availableActions(S.PENDING_THERAPY_HEAD, therapyHead()), ["APPROVE", "SEND_BACK", "REJECT"]);
  assert.deepEqual(W.availableActions(S.PENDING_THERAPY_HEAD, owner), []);
  assert.deepEqual(W.availableActions(S.PENDING_DIRECTOR, director()), ["ADMIT", "WAITLIST", "SEND_BACK", "REJECT"]);
  assert.deepEqual(W.availableActions(S.REJECTED, director()), []);
});

test("only drafts and returned applications are editable", () => {
  assert.equal(W.isEditable(S.DRAFT), true);
  assert.equal(W.isEditable(S.RETURNED), true);
  assert.equal(W.isEditable(S.PENDING_THERAPY_HEAD), false);
  assert.equal(W.isEditable(S.ADMITTED), false);
});

test("reviewerRole names who decides at each waiting status", () => {
  assert.equal(W.reviewerRole(S.PENDING_THERAPY_HEAD), "THERAPY_HEAD");
  assert.equal(W.reviewerRole(S.PENDING_CENTRE_HEAD), "CENTRE_HEAD");
  assert.equal(W.reviewerRole(S.PENDING_DIRECTOR), "DIRECTOR");
  assert.equal(W.reviewerRole(S.WAITLISTED), "DIRECTOR");
  assert.equal(W.reviewerRole(S.DRAFT), null);
});
