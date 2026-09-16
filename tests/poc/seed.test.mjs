// The dev server's demo data: one application left at every stage of the approval workflow, so a
// person can open the app and see a queue before uploads exist (M7). The seed walks the real
// actions, and the staff it mints must be able to sign in from a browser with the printed password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, pbkdf2Sync } from "node:crypto";
import { seedDemoData } from "../../poc/seed/demo-applications.mjs";

const require = createRequire(import.meta.url);
const { plain } = require("./harness.js");

const KEY_BYTES = 32;
const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");
// What the browser does on the sign-in screen: ask for the salt, then derive the key from the
// password with PBKDF2 (public/js/kdf.js). The server only ever sees the key.
const deriveAsBrowser = (password, salt, iterations) =>
  pbkdf2Sync(password, Buffer.from(salt, "hex"), iterations, KEY_BYTES, "sha256").toString("hex");

// One case per row of the plan, in the order the seed walks them.
const STAGES = ["PENDING_THERAPY_HEAD", "PENDING_CENTRE_HEAD", "PENDING_DIRECTOR", "RETURNED", "ADMITTED"];

test("the demo seed leaves one application at every stage", () => {
  const { call, ids } = seedDemoData();
  // Read as the Therapy Head: she is the only role that sees every centre's work.
  const statuses = ids.map((id) => call("lakshmi", "applications.get", { id }).data.status);
  assert.deepEqual(statuses, STAGES);
});

test("the seed uses the real actions, so a broken workflow rule would stop it", () => {
  const { call, ids } = seedDemoData();
  // Nila M is already waiting on the Therapy Head: submitting her again cannot move her.
  assert.equal(call("priya", "applications.submit", { id: ids[0] }).error.code, "INVALID_TRANSITION");
});

test("the admitted demo application has a registration number", () => {
  const { call, ids } = seedDemoData();
  const admitted = call("lakshmi", "applications.get", { id: ids[4] }).data;
  assert.equal(admitted.status, "ADMITTED");
  assert.match(admitted.registrationNo, /^SWB\/[A-Z]{3}\/20\d\d\/\d{4}$/);
});

test("the sent-back demo application still has work to do", () => {
  const { call, ids } = seedDemoData();
  const app = call("lakshmi", "applications.get", { id: ids[3] }).data;
  assert.equal(app.status, "RETURNED");
  // The therapist's screen lists every section the form itself would not accept, in both of the
  // states it draws: the diagnosis answer the therapist is still to fill in again, and the
  // development history nobody has started. A demo case with every answer in place lists nothing, so
  // that part of the screen is never seen.
  const steps = app.completion.steps;
  assert.deepEqual(Object.keys(steps).filter((step) => steps[step] !== "done"), ["s4", "s5"]);
  assert.equal(steps.s4, "incomplete");
  assert.equal(steps.s5, "empty");
});

test("the sent-back demo application is refused until its missing answer is filled in", () => {
  const { call, ids } = seedDemoData();
  // Sending it again is what the "Fix and resend" button does, and it is refused with the answer it
  // names — the one thing a screen that sends a file on has to get right. Nothing else about the case
  // is incomplete, so this is the whole of the complaint.
  const sent = call("deepa", "applications.submit", { id: ids[3] });
  assert.equal(sent.ok, false);
  assert.equal(sent.error.code, "VALIDATION_FAILED");
  assert.deepEqual(plain(sent.error.details.errors), { s4_asd_diagnosed: "REQUIRED" });
});

test("a sent-back application carries the reason on its routing slip", () => {
  const { call, ids } = seedDemoData();
  const slip = call("lakshmi", "applications.get", { id: ids[3] }).data.approvals;
  const sendBack = slip.find((row) => row.action === "SEND_BACK");
  assert.ok(sendBack, "the routing slip should show the send-back");
  assert.ok(sendBack.comment.length > 0, "a send-back must say why");
  assert.ok(sendBack.userName, "the slip should name the person who sent it back");
});

test("every role's queue has the application that is waiting for it", () => {
  const { call } = seedDemoData();
  const items = (who) => call(who, "applications.list", {}).data.items;
  const waiting = (who, status) => items(who).filter((item) => item.status === status);

  assert.equal(waiting("lakshmi", "PENDING_THERAPY_HEAD").length, 1);
  assert.equal(waiting("suresh", "PENDING_CENTRE_HEAD").length, 1);
  assert.equal(waiting("revathi", "PENDING_DIRECTOR").length, 1);
  // A therapist sees only their own, and both therapists have work of their own on the board.
  assert.ok(items("priya").length > 0, "the first therapist should have applications");
  assert.ok(items("deepa").length > 0, "the second therapist should have applications");
  assert.ok(items("priya").length < items("lakshmi").length, "a therapist must not see everyone's");
});

test("every demo person can sign in from a browser with the printed password", () => {
  const { ctx, people, password } = seedDemoData();
  assert.ok(people.length >= 5, "the demo needs two therapists and one of each head, at least");
  for (const person of people) {
    const pre = plain(ctx.SC_Api.handle({ action: "auth.prelogin", data: { email: person.email } }));
    assert.equal(pre.ok, true, `no salt for ${person.email}`);
    const key = deriveAsBrowser(password, pre.data.salt, pre.data.iterations);
    const login = plain(ctx.SC_Api.handle({ action: "auth.login", data: { email: person.email, key } }));
    assert.equal(login.ok, true, `${person.email} could not sign in from the app: ${JSON.stringify(login.error)}`);
    assert.deepEqual(login.data.user.roles, person.roles);
    assert.equal(login.data.user.mustChangePassword, false, "the password gate would stop the demo at the door");
    // The stored hash is the hash of the key the browser derives — the same shape a real account has.
    const row = plain(ctx.SC_Store.find("Users", "email", person.email));
    assert.equal(row.password_hash, sha256Hex(key));
    assert.equal(row.password_salt, pre.data.salt);
  }
});
