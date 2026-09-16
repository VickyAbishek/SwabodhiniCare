# M6: Workflow Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD for every server action and pure module (Node's test runner). Screens are checked in a real browser against the local dev server.

**Goal:** An application can move from draft to admitted: the therapist sends it, the Therapy Head, Centre Head and Director each see it in their queue and act on it, the Director signs with their password and a registration number is issued — with every decision, name, comment, time and form fingerprint left on the routing slip.

**Architecture:** The state machine already exists and is fully tested in `shared/workflow.js`; M6 adds the five server actions that drive it, a demo seed so the flow can be shown before uploads exist, and the screens. `poc/apps-script/Applications.gs` gains `submit`, `review`, `decide`, `reopen` and `withdraw`, each one re-reading the row inside `SC_Store.withLock` and asking `SC_Workflow.next()` whether the move is legal. Screens are plain HTML in `public/`, talking only through `public/js/api.js`.

**Tech Stack:** Apps Script (POC server), plain ES modules, Node's built-in test runner, Playwright for the browser pass. No frameworks, no npm runtime dependencies.

**Spec:** main spec §4 (roles, separation of duties), §5 (workflow, fingerprint, lock, registration number), §7 (My Queue, overdue), §8 (data model), §9 (API), §10.1 (step-up), §10.4 (audit), §12 (UX, confirmations); POC spec §5 (actions), §6 (`Approvals`/`Config` tabs), §8 (freshness, locks, counters); scope map F1, F3, F4, F12–F14, F16; mockups `docs/mockups/index.html` (S2, S6, S7) and `flow.html` (T4, C1, B1, D1).

## Global Constraints

Carried from the M5 plan, still binding:
- Every write inside `SC_Store.withLock`; every save carries the `version` it started from (`VERSION_CONFLICT` otherwise).
- Server validation uses `SC_FormRules.validate(...)` with `today` in Asia/Kolkata. Unknown fields are refused.
- Therapists see only their own applications; Heads, Director and Admin see all (`SC_Permissions`). Somebody who can't see an application gets `NOT_FOUND`, so its existence isn't revealed.
- Only the person who filled it in can edit it, and only while it is `DRAFT` or `RETURNED` (`SC_Workflow.isEditable`).
- Counters come from `SC_Store.nextSeq` inside the lock, so numbers are never duplicated.

New in M6:
- **Every decision is re-decided on the server.** The screens may hide a button, but `SC_Workflow.next()` is what actually refuses the move — the client is never trusted.
- **No screen may branch on `IS_DEMO`** except the three allowed places (test banner, sample-data button, Backup now). Scope map §1.4.
- All user-facing text comes from `public/i18n/en.json` / `ta.json` or `SC_Actions.ERRORS`. No new error codes: M6 reuses the twelve that already exist.
- Tamil strings are a first draft awaiting school-staff review; add them, don't block on them.

## Decisions settled before coding

These were open in the specs. The plan commits to the following; each is testable.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | What is `approvedThisRound`? | User ids who took an **approving** action (`APPROVE` or `ADMIT`) on this application since its `submitted_at`. `WAITLIST` does not count. | Separation of duties needs "one person cannot approve two stages", but a Director who waitlisted must still be able to admit later (`tests/shared/workflow.test.js` asserts exactly this). Each `SUBMIT` re-stamps `submitted_at`, so a send-back and resend starts a fresh round for free. |
| 2 | How many buttons does the Director get? | Four: **Admit, Waitlist, Send back, Reject** — the order `TRANSITIONS.PENDING_DIRECTOR` already uses. | Main §5 says "each reviewer has three buttons… the Director also has Waitlist". `shared/workflow.js` and flow.html stage 4 agree; the S7 mockup only shows the two *choices*, not the whole bar. |
| 3 | Where does the step-up salt come from? | The decision screen calls the existing **`auth.prelogin`** with the signed-in Director's email, derives the key with `kdf.js`, and sends it. No new server action. | No step-up helper exists, and `auth.prelogin` is already the only tested path to a user's salt and iteration count. |
| 4 | Is a waitlisted application "locked"? | Read-only, but not labelled "locked". | `isEditable` already makes it read-only. No spec calls `WAITLISTED` locked, and only `ADMIT` is legal from there. |
| 5 | Does the registration number survive a reopen? | **Yes — a registration number is issued once and never re-issued.** Reopen keeps it; a later admit does not mint a second one. | Main §8 declares it `UNIQUE`. Changing it would break the printed report already in the family's hands. **Flagged: the reopen flow is still an open decision in TODO.md; confirm this when that is settled.** |
| 6 | "Waiting for Therapy Head" or "Waiting: Therapy Head"? | Keep the shipped i18n (`Waiting: Therapy Head`). | `en.json` is the built artefact; the mockup predates it. |
| 7 | Reopen → all approvals again? | Yes: `ADMITTED → REOPEN → RETURNED`, and a resubmit restarts at the Therapy Head. | Already built that way, and recorded as open in TODO.md "Decisions still open". No change. |
| 8 | Retention of rejected/withdrawn? | Nothing is deleted in the POC. | Main §16 Q7 ("anonymise after 2 years") is not a POC concern; the withdraw screen says nothing is deleted. |

---

## M6a: Server actions (`poc/apps-script/Applications.gs`)

### Task 1: The form fingerprint

Main §5: on approve the system *"stores a SHA-256 hash of the form data with the approval, so any later change can be detected"*. Main §8: `approvals.form_hash TEXT NOT NULL, -- SHA-256 of form_json at decision time`.

**Files:**
- Modify: `poc/apps-script/Applications.gs` (add `formHash`, export it)
- Test: `tests/poc/applications.test.js`

**Interfaces:**
- Produces: `SC_Applications.formHash(row) -> string` — 64 lowercase hex characters.

The hash is taken over `formValues(row)`, which rebuilds the answers in `SC_FormSchema.allFields()` order, so the same answers always give the same hash and `JSON.stringify` is deterministic.

- [x] **Step 1: Write the failing test**

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `ctx.SC_Applications.formHash is not a function`.

- [x] **Step 3: Write minimal implementation**

```js
  // Main spec §5: a SHA-256 of the answers, stored with every decision so a later change shows up.
  function formHash(row) {
    return SC_Crypto.sha256Hex(JSON.stringify(formValues(row)));
  }
```

Add `formHash: formHash` to the frozen object the module returns.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs tests/poc/applications.test.js
git commit -m "feat: fingerprint the answers so a later change can be detected"
```

---

### Task 2: `applications.submit`

Moves `DRAFT` or `RETURNED` to `PENDING_THERAPY_HEAD`, owner only, after the **submit-mode** check.

**Files:**
- Modify: `poc/apps-script/Applications.gs`
- Modify: `shared/actions.js` (contract entry `"applications.submit": { auth: "user" }`)
- Test: `tests/poc/applications.test.js`

**Interfaces:**
- Consumes: `SC_Workflow.next`, `SC_FormRules.validate`, `SC_Audit.log`
- Produces: `applications.submit { id } -> { ok, data: view }`, errors `NOT_ALLOWED`, `VALIDATION_FAILED`, `INVALID_TRANSITION`, `NOT_FOUND`

A signature is just a non-empty string to the validator (`shared/form-rules.js` line 112), so this action is fully testable now even though no screen can produce one until M7.

- [x] **Step 1: Write the failing tests**

```js
test("only the owner can send an application for review", () => {
  const { as } = setupPeople();
  const { id } = draftFor(as, "priya", {});
  // Lakshmi is a Therapy Head, so she can see the application and is refused only for not
  // having written it. Deepa is a plain therapist, so its existence is not revealed to her
  // at all — the same pair the existing "only the author can save" test establishes.
  assert.equal(as("lakshmi")("applications.submit", { id }).error.code, "NOT_ALLOWED");
  assert.equal(as("deepa")("applications.submit", { id }).error.code, "NOT_FOUND");
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
```

Add one helper to `tests/poc/applications.test.js`. The file already has `draftFor(as, name, values)` and `const SAMPLE = require("../fixtures/sample-application.js")` at the top, and `SAMPLE` is a **complete** application: it passes `validate(..., { mode: "submit" })` and scores 11 of 11 steps, because it already carries `s11_signature: "att-sig-1"` and `s2_photo: ["att-photo-1"]`. Do not add a signature to it.

```js
// An application already waiting for the Therapy Head.
function submitReady(as, who) {
  const created = draftFor(as, who, SAMPLE);
  as(who)("applications.submit", { id: created.id });
  return created;
}
```

Remember `plain()` (already imported) whenever a test deep-compares an array or object that came out of the vm context.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `UNKNOWN_ACTION: applications.submit`.

- [x] **Step 3: Write minimal implementation**

```js
  // DRAFT or RETURNED -> PENDING_THERAPY_HEAD. Only the owner; every answer is checked again in
  // submit mode, because a draft may have been saved while questions were still missing.
  function submit(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      // Who may act comes before what the answers say: somebody who is not allowed must not
      // learn which of their answers the server would have complained about.
      var move = SC_Workflow.next(row.status, "SUBMIT", {
        actorId: session.user.id, actorRoles: session.user.roles, createdBy: row.created_by,
      });
      if (!move.ok) return fail(move.error);
      var values = formValues(row);
      var check = SC_FormRules.validate(values, { mode: "submit", today: SC_Store.todayIso() });
      if (!check.ok) return fail("VALIDATION_FAILED", { errors: check.errors });
      var now = SC_Store.nowIso();
      var saved = SC_Store.update("Applications", row.id, {
        status: move.status, submitted_at: now, updated_at: now, version: row.version + 1,
      });
      SC_Audit.log(session.user.id, "applications.submitted", "Applications", row.id, { appNo: row.app_no });
      return SC_Actions.ok(view(saved));
    });
  }
```

Register it: `SC_Api.register("applications.submit", SC_Applications.submit);` and add `submit: submit` to the module's frozen return.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS (all four).

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs shared/actions.js tests/poc/applications.test.js
git commit -m "feat: let the owner send an application for review"
```

---

### Task 3: `applications.withdraw`

`DRAFT` or `RETURNED` → `WITHDRAWN`. Owner or Admin. Nothing is deleted.

**Files:**
- Modify: `poc/apps-script/Applications.gs`, `shared/actions.js`
- Test: `tests/poc/applications.test.js`

**Interfaces:**
- Produces: `applications.withdraw { id } -> { ok, data: view }`, errors `NOT_ALLOWED`, `INVALID_TRANSITION`, `NOT_FOUND`

- [x] **Step 1: Write the failing tests**

```js
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
```

`submitReady` is the helper added in Task 2, so Task 2 lands before this one.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `UNKNOWN_ACTION: applications.withdraw`.

- [x] **Step 3: Write minimal implementation**

```js
  // DRAFT or RETURNED -> WITHDRAWN. The owner, or an Admin acting for the family. Nothing is
  // deleted: the record and its routing slip stay for the audit log.
  function withdraw(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      var move = SC_Workflow.next(row.status, "WITHDRAW", {
        actorId: session.user.id, actorRoles: session.user.roles, createdBy: row.created_by,
      });
      if (!move.ok) return fail(move.error);
      var saved = SC_Store.update("Applications", row.id, {
        status: move.status, updated_at: SC_Store.nowIso(), version: row.version + 1,
      });
      SC_Audit.log(session.user.id, "applications.withdrawn", "Applications", row.id, { appNo: row.app_no });
      return SC_Actions.ok(view(saved));
    });
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs shared/actions.js tests/poc/applications.test.js
git commit -m "feat: let the owner or an Admin withdraw an application"
```

---

### Task 4: `applications.review` — Approve, Send back, Reject

The heart of M6. Also writes the routing slip.

**Files:**
- Modify: `poc/apps-script/Applications.gs`, `shared/actions.js`
- Test: `tests/poc/applications.test.js`

**Interfaces:**
- Consumes: `SC_Workflow.next`, `SC_Applications.formHash` (Task 1), `applications.submit` (Task 2)
- Produces: `applications.review { id, action, comment } -> { ok, data: view }` where `action` is one of `APPROVE`, `SEND_BACK`, `REJECT`; errors `INVALID_REQUEST`, `NOT_ALLOWED`, `OWN_APPLICATION`, `ALREADY_APPROVED_STAGE`, `COMMENT_REQUIRED`, `INVALID_TRANSITION`, `NOT_FOUND`
- Produces: an `Approvals` row per decision — `{ id, application_id, stage, action, comment, user_id, form_hash, created_at }`

`ADMIT` and `WAITLIST` are **refused here** and belong to Task 5, which additionally demands the Director's password.

- [x] **Step 1: Write the failing tests**

```js
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
  const { as } = setupPeople();
  const { id } = submitReady(as, "priya");
  as("lakshmi")("applications.review", { id, action: "APPROVE" });
  as("suresh")("applications.review", { id, action: "SEND_BACK", comment: "Please fix." });
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `UNKNOWN_ACTION: applications.review`.

- [x] **Step 3: Write minimal implementation**

```js
  // Which stage a waiting application is at, for the routing slip.
  var STAGE_BY_STATUS = {
    PENDING_THERAPY_HEAD: "THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "CENTRE_HEAD",
    PENDING_DIRECTOR: "DIRECTOR",
  };
  var REVIEW_ACTIONS = ["APPROVE", "SEND_BACK", "REJECT"];

  // One person may not approve two stages of the same application. A round starts at each submit,
  // so a send-back and resend clears it. Waitlisting is not approving: a Director who waitlisted
  // must still be able to admit later.
  function approversThisRound(applicationId, submittedAt) {
    return SC_Store.filter("Approvals", function (r) {
      if (r.application_id !== applicationId) return false;
      if (r.action !== "APPROVE" && r.action !== "ADMIT") return false;
      return !submittedAt || r.created_at >= submittedAt;
    }).map(function (r) { return r.user_id; });
  }

  function review(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    if (REVIEW_ACTIONS.indexOf(data.action) === -1) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      var move = SC_Workflow.next(row.status, data.action, {
        actorId: session.user.id, actorRoles: session.user.roles, createdBy: row.created_by,
        comment: data.comment, approvedThisRound: approversThisRound(row.id, row.submitted_at),
      });
      if (!move.ok) return fail(move.error);
      var now = SC_Store.nowIso();
      SC_Store.insert("Approvals", {
        id: SC_Store.newId(), application_id: row.id, stage: STAGE_BY_STATUS[row.status],
        action: data.action, comment: String(data.comment || "").trim() || null,
        user_id: session.user.id, form_hash: formHash(row), created_at: now,
      });
      var saved = SC_Store.update("Applications", row.id, {
        status: move.status, updated_at: now, version: row.version + 1,
      });
      SC_Audit.log(session.user.id, "applications.reviewed", "Applications", row.id, { action: data.action });
      return SC_Actions.ok(view(saved));
    });
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs shared/actions.js tests/poc/applications.test.js
git commit -m "feat: let each reviewer approve, send back or reject"
```

---

### Task 5: `applications.decide` — the Director's decision

**Files:**
- Modify: `poc/apps-script/Auth.gs` (extract and export `verifyKey`)
- Modify: `poc/apps-script/Applications.gs`, `shared/actions.js`
- Test: `tests/poc/auth.test.js`, `tests/poc/applications.test.js`

**Interfaces:**
- Consumes: `SC_Auth.verifyKey(user, key) -> boolean` (new), `SC_Numbers.formatRegNo`, `SC_Store.nextSeq`
- Produces: `applications.decide { id, action, comment, key } -> { ok, data: view }` where `action` is `ADMIT` or `WAITLIST`; errors `INVALID_REQUEST`, `NOT_ALLOWED`, `INVALID_CREDENTIALS`, `COMMENT_REQUIRED`, `INVALID_TRANSITION`, `NOT_FOUND`

- [x] **Step 1: Write the failing tests**

First, `verifyKey` (in `tests/poc/auth.test.js`):

```js
test("verifyKey accepts the right key and refuses the wrong one", () => {
  const ctx = createContext({ properties: { HMAC_SECRET: "test-secret" } });
  ctx.SC_Store.ensureTabs();
  const key = "key-anand";
  ctx.SC_Store.insert("Users", {
    id: "u-1", email: "a@example.com", name: "A", roles: ["DIRECTOR"],
    password_hash: require("node:crypto").createHash("sha256").update(key).digest("hex"),
    password_salt: "0123456789abcdef0123456789abcdef", is_active: true, must_change_password: false,
  });
  const user = ctx.SC_Store.find("Users", "id", "u-1");
  assert.equal(ctx.SC_Auth.verifyKey(user, key), true);
  assert.equal(ctx.SC_Auth.verifyKey(user, "not-the-key"), false);
});
```

Then the decision itself (in `tests/poc/applications.test.js`):

```js
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/auth.test.js tests/poc/applications.test.js`
Expected: FAIL — `ctx.SC_Auth.verifyKey is not a function`, then `UNKNOWN_ACTION: applications.decide`.

- [x] **Step 3: Write minimal implementation**

In `Auth.gs`, extract the check `changePassword` already makes and export it:

```js
  // The password never leaves the device: the phone sends PBKDF2(password, salt) and we compare
  // SHA-256 of that with the stored hash. Used at sign-in, on a password change and on the
  // Director's step-up before a final decision (main spec §10.1).
  function verifyKey(user, key) {
    return typeof key === "string" && key !== "" &&
      SC_Crypto.safeEqual(SC_Crypto.sha256Hex(key), user.password_hash);
  }
```

Change `changePassword` to use it (`if (!user || !verifyKey(user, data.currentKey)) return SC_Actions.fail("INVALID_CREDENTIALS");`) and add `verifyKey: verifyKey` to the module's exports.

In `Applications.gs`:

```js
  var DECISION_ACTIONS = ["ADMIT", "WAITLIST"];

  // The Director's decision (main spec §5, §10.1). Admit and Waitlist both need the Director's
  // password again: the phone derives the key and this checks it. Admit issues the registration
  // number from a per-centre, per-year counter inside the lock, so it can never repeat.
  function decide(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    if (DECISION_ACTIONS.indexOf(data.action) === -1) return fail("INVALID_REQUEST");
    // A missing password is a malformed request; a wrong one is INVALID_CREDENTIALS, below.
    if (typeof data.key !== "string" || !data.key) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      var user = SC_Store.find("Users", "id", session.user.id);
      if (!SC_Permissions.can(session.user.roles, "decision.final") || !user || !SC_Auth.verifyKey(user, data.key)) {
        return fail(SC_Permissions.can(session.user.roles, "decision.final") ? "INVALID_CREDENTIALS" : "NOT_ALLOWED");
      }
      var move = SC_Workflow.next(row.status, data.action, {
        actorId: session.user.id, actorRoles: session.user.roles, createdBy: row.created_by,
        comment: data.comment, approvedThisRound: approversThisRound(row.id, row.submitted_at),
      });
      if (!move.ok) return fail(move.error);
      var now = SC_Store.nowIso();
      var patch = { status: move.status, updated_at: now, version: row.version + 1 };
      if (move.status === "ADMITTED" && !row.registration_no) {
        if (SC_Numbers.CENTRE_CODES.indexOf(row.centre) === -1) return fail("INVALID_REQUEST");
        var year = Number(now.slice(0, 4));
        patch.registration_no = SC_Numbers.formatRegNo(row.centre, year, SC_Store.nextSeq("reg_seq:" + row.centre + ":" + year));
        patch.decided_at = now;
      }
      SC_Store.insert("Approvals", {
        id: SC_Store.newId(), application_id: row.id, stage: "DIRECTOR", action: data.action,
        comment: String(data.comment || "").trim() || null, user_id: session.user.id,
        form_hash: formHash(row), created_at: now,
      });
      var saved = SC_Store.update("Applications", row.id, patch);
      SC_Audit.log(session.user.id, "applications.decided", "Applications", row.id, { action: data.action });
      return SC_Actions.ok(view(saved));
    });
  }
```

Add `registrationNo: row.registration_no || null` and `decidedAt: row.decided_at || null` to `view()` if they are not already there (`registrationNo` is; `decidedAt` is not — add it).

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/auth.test.js tests/poc/applications.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Auth.gs poc/apps-script/Applications.gs shared/actions.js tests/poc/auth.test.js tests/poc/applications.test.js
git commit -m "feat: let the Director admit or waitlist with their password"
```

---

### Task 6: `applications.reopen`, plus the routing slip on `get`

**Files:**
- Modify: `poc/apps-script/Applications.gs`, `shared/actions.js`
- Test: `tests/poc/applications.test.js`

**Interfaces:**
- Produces: `applications.reopen { id, reason } -> { ok, data: view }`; errors `NOT_ALLOWED`, `COMMENT_REQUIRED`, `INVALID_TRANSITION`, `NOT_FOUND`
- Produces: `applications.get` now returns `approvals: [{ stage, action, comment, userName, at }]`, oldest first — the routing slip

- [x] **Step 1: Write the failing tests**

```js
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

test("a reopened application goes through the chain again but keeps its history", () => {
  const { as } = setupPeople();
  const id = atDirector(as);
  as("revathi")("applications.decide", { id, action: "ADMIT", key: directorKey() });
  as("revathi")("applications.reopen", { id, reason: "Centre transfer." });
  as("priya")("applications.submit", { id });

  const slip = as("priya")("applications.get", { id }).data.approvals;
  assert.equal(slip.length, 4);
  assert.equal(slip[3].action, "REOPEN");
  assert.equal(as("lakshmi")("applications.review", { id, action: "APPROVE" }).data.status, "PENDING_CENTRE_HEAD");
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `UNKNOWN_ACTION: applications.reopen`, and `approvals` undefined.

- [x] **Step 3: Write minimal implementation**

```js
  // ADMITTED -> RETURNED, for corrections after signing. Director or Admin, reason required.
  // The registration number stands: it has already been printed on the family's report.
  function reopen(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      var move = SC_Workflow.next(row.status, "REOPEN", {
        actorId: session.user.id, actorRoles: session.user.roles, createdBy: row.created_by,
        comment: data.reason,
      });
      if (!move.ok) return fail(move.error);
      var now = SC_Store.nowIso();
      SC_Store.insert("Approvals", {
        id: SC_Store.newId(), application_id: row.id, stage: "DIRECTOR", action: "REOPEN",
        comment: String(data.reason || "").trim(), user_id: session.user.id,
        form_hash: formHash(row), created_at: now,
      });
      var saved = SC_Store.update("Applications", row.id, {
        status: move.status, updated_at: now, version: row.version + 1,
      });
      SC_Audit.log(session.user.id, "applications.reopened", "Applications", row.id, null);
      return SC_Actions.ok(view(saved));
    });
  }

  // The routing slip (POC spec §6): the Approvals rows for this application, oldest first.
  function approvalsFor(id) {
    return SC_Store.filter("Approvals", function (r) { return r.application_id === id; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; })
      .map(function (r) {
        var user = SC_Store.find("Users", "id", r.user_id);
        return { stage: r.stage, action: r.action, comment: r.comment, userName: user ? user.name : "", at: r.created_at };
      });
  }
```

Add `approvals: approvalsFor(row.id)` to the object `view()` returns.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs shared/actions.js tests/poc/applications.test.js
git commit -m "feat: let the Director reopen a signed application, and return the routing slip"
```

---

## M6b: Demo seed

### Task 7: Seed the dev server with applications at every stage

No screen can produce a signature until M7, so without a seed there is nothing in any queue and M6 cannot be shown or clicked through. The seed calls the **real actions**, so it also exercises them.

**Files:**
- Create: `poc/seed/demo-applications.mjs`
- Modify: `poc/scripts/dev-server.mjs`
- Test: `tests/poc/seed.test.mjs`

**Interfaces:**
- Consumes: `tests/poc/harness.js` `createContext`, `plain`; `tests/poc/people.js` `PEOPLE`, `sha`
- Produces: `seedDemoData(ctx, { call, today }) -> { people, applicationIds }` where `call(personName, action, data)` runs one API call and `today` is an ISO date

- [x] **Step 1: Write the failing test**

```js
test("the demo seed leaves work in every queue", () => {
  const { ctx, call, ids } = seedDemoData();
  const statuses = ids.map((id) => call("priya", "applications.get", { id }).data.status);
  assert.deepEqual(plain(statuses), [
    "PENDING_THERAPY_HEAD", "PENDING_CENTRE_HEAD", "PENDING_DIRECTOR", "RETURNED", "ADMITTED",
  ]);
});

test("the seed uses the real actions, so it would fail loudly if a rule broke", () => {
  const { call, ids } = seedDemoData();
  assert.equal(call("priya", "applications.submit", { id: ids[0] }).error.code, "INVALID_TRANSITION");
});

test("the admitted demo application has a registration number", () => {
  const { call, ids } = seedDemoData();
  const admitted = call("priya", "applications.get", { id: ids[4] }).data;
  assert.match(admitted.registrationNo, /^SWB\/[A-Z]{3}\/20\d\d\/\d{4}$/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/poc/seed.test.mjs`
Expected: FAIL — cannot find module `poc/seed/demo-applications.mjs`.

- [x] **Step 3: Write minimal implementation**

`poc/seed/demo-applications.mjs` builds on `public/js/seed/sample-applications.js` (already held to the submit check), varies the applicant name per case, adds the signature string M7 will replace, and walks each case to its target stage through the real endpoints. Shape:

```js
// scope: poc
// Fictional applications for the dev server, one left at each stage, so the queues can be shown
// before uploads exist (M7). Everything goes through the real actions: if a rule changed, the
// seed would stop working, which is the point.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createContext, plain } = require("../../tests/poc/harness.js");
const { PEOPLE, sha } = require("../../tests/poc/people.js");
const { SAMPLE_APPLICANT } = await import("../../public/js/seed/sample-applications.js");

const CASES = [
  { name: "Nila M", to: [] },                                              // Waiting: Therapy Head
  { name: "Arjun K", to: ["APPROVE"] },                                    // Waiting: Centre Head
  { name: "Vishal S", to: ["APPROVE", "APPROVE"] },                        // Waiting: Director
  { name: "Meena R", to: ["APPROVE", "SEND_BACK"] },                       // Sent back
  { name: "Kavya S", to: ["APPROVE", "APPROVE", "ADMIT"] },                // Admitted
];
```

`seedDemoData()` creates the context, inserts the same fictional staff `people.js` uses, signs each in, creates one application per case from the sample answers, then applies `to` step by step — `APPROVE`/`SEND_BACK` through `applications.review`, `ADMIT` through `applications.decide` with the Director's key.

In `poc/scripts/dev-server.mjs`, call the seed during start-up and log the first-admin code **and** the demo sign-in details, so a person opening the app knows what to try. Keep the seed behind an env var (`SEED=0` to skip) so the test suite and a clean run are unaffected.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/poc/seed.test.mjs`
Expected: PASS.

- [x] **Step 5: Check it in the browser**

Restart the dev server, open `home.html`, sign in as each role in turn and confirm each queue has the expected application.

- [x] **Step 6: Commit**

```bash
git add poc/seed/demo-applications.mjs poc/scripts/dev-server.mjs tests/poc/seed.test.mjs
git commit -m "feat: seed the dev server with an application at every stage"
```

---

## M6c: Screens

Each screen's task ends with a browser pass against the seeded dev server — that is the test for screen work in this repo. Screens carry `<!-- scope: shared -->`, use `textContent` and DOM APIs only, and every new string goes into both `en.json` and `ta.json` (113 keys today, and they must stay equal).

### Task 8: The text

**Files:** Modify `public/i18n/en.json`, `public/i18n/ta.json`.

Add, in both files: `queue.title`, `queue.waiting` (`{n}` applications waiting), `queue.empty`, `queue.yourTurn`, `queue.waitingDays` (`Waiting {n} days`), `queue.stepOf` (`Step {n} of 4: {role}`), `queue.from` (`from {name}`), `review.title`, `review.readFull`, `review.facts`, `review.diagnosis`, `review.view`, `review.recommended`, `review.safety`, `review.approvalRoute`, `review.comment`, `review.commentHint`, `action.approve`, `action.sendBack`, `action.reject`, `action.admit`, `action.waitlist`, `action.signAndAdmit`, `slip.therapist`, `slip.filledIn`, `slip.sent`, `slip.approved`, `slip.waitingSince`, `slip.notYet`, `slip.you`, `confirm.sendTitle`, `confirm.sendBody`, `confirm.yesSend`, `confirm.noGoBack`, `confirm.approveTitle`, `confirm.yesApprove`, `confirm.decideTitle`, `decide.title`, `decide.decision`, `decide.regNo`, `decide.signature`, `decide.password`, `decide.lockNote`, `decide.admitted`, `decide.registrationNumber`, `decide.signedBy`, `decide.locked`, `sentBack.title`, `sentBack.stepsToFix`, `sentBack.resendNote`, `sentBack.fixAndResend`, `reopen.title`, `reopen.reason`, `withdraw.title`, `withdraw.confirm`, `withdraw.done`, `common.open`, `common.backToQueue`, `common.backToApplication`, `common.printReport`.

The English wording is in the mockups and in the spec extract above; take it from there rather than inventing. The Tamil is a first draft (already flagged for school-staff review).

> **Corrected at M6 close-out — two of those keys were never added.** `slip.therapist` shipped as
> `role.THERAPIST` ("Therapist" / "சிகிச்சையாளர்") and `sentBack.title` as `status.RETURNED` ("Sent
> back" / "திருப்பி அனுப்பப்பட்டது"); in both cases the key already held the same words in both
> languages, so a second one would have been a duplicate. Task 8 shipped **171 keys each** (113 → 171),
> and its block above names 58 of the 86 added — the other **28 are listed under "Carry-forwards
> recorded at M6 close-out"** below, because the Tamil review has to read them: they were written by
> the implementers rather than lifted from a mockup.

- [x] Add the keys, then run `node --test tests/public/i18n.test.mjs` — it already asserts the two files hold the same keys. Expected: PASS.
- [x] Commit: `git commit -m "feat: add the workflow screens' English and Tamil text"`

---

### Task 9: My Queue

**Files:** Modify `poc/apps-script/Applications.gs` (add `dob` to `listItem`), `tests/poc/applications.test.js`; create `public/js/routing-slip.js` (the shared 4-step component, pure model + DOM); modify `public/home.html`, `public/js/pages/home.js`, `public/css/app.css`; Test `tests/public/routing-slip.test.mjs`.

Start with the one server change this screen needs. `listItem` carries no `dob`, so the card cannot show the age the mockup asks for (`"19 yrs · Male · Selaiyur"`). Add it and let the client work the age out with `SC_Dates`, rather than a second round-trip per card or a stored age that goes stale.

- [x] **Step 1: Write the failing server test**

```js
test("the list carries the date of birth so a queue card can show the age", () => {
  const { as } = setupPeople();
  as("priya")("applications.create", { values: SAMPLE });
  const list = as("lakshmi")("applications.list", {});
  assert.equal(list.data.items[0].dob, SAMPLE.s2_dob);
});
```

- [x] **Step 2: Run it, watch it fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `undefined !== "2020-03-14"`.

- [x] **Step 3: Add `dob` to `listItem`**

```js
  function listItem(row) {
    return {
      id: row.id, appNo: row.app_no, applicantName: row.applicant_name || "", centre: row.centre,
      dob: row.dob || null, gender: row.gender || null,
      status: row.status, createdBy: row.created_by, updatedAt: row.updated_at,
      safetyFlags: SC_FormRules.safetyFlags(formValues(row)),
    };
  }
```

`gender` comes along free from the same summary columns and saves a second lookup for the same line of the card.

- [x] **Step 4: Run it, watch it pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS.

**Interfaces:**
- Produces: `createRoutingSlip({ workflow })` with `track(status) -> { step, total: 4, label }` and `slip({ status, approvals, names }) -> [{ stage, state: "done"|"now"|"todo", name, meta, comment }]`

Main §7 + POC §8 govern this screen:
- The therapist sees only their own; Heads, Director and Admin see all (`applications.list` already scopes this).
- **Refresh every 60 seconds while the screen is visible**, paused when the tab is hidden, plus a Refresh button (POC §8). Use `setInterval` cleared on `visibilitychange`.
- Cards: applicant name, `age · gender · centre`, a "Your turn" stamp when the person is the reviewer for that status, an overdue flag past 7 days (main §7 R5), the 4-step track, `APP-….` and who sent it.
- Empty state: "No applications are waiting for you."
- Rows needing *this* person's action sort first; `SC_Workflow.reviewerRole(status)` says whose turn it is, and `SC_Workflow.availableActions(status, ctx)` says whether this person may act.

- [x] TDD the two pure functions in `routing-slip.js` (track position per status; slip states from approvals) — they are testable without a DOM.
- [x] Build the queue on Home, replacing the "My Queue arrives in M6" note.
- [x] Browser pass: sign in as Lakshmi and confirm the Therapy Head card is stamped "Your turn" and the admitted one is not.
- [x] Commit: `git commit -m "feat: show each person the work waiting for them"`

---

### Task 10: Review screen

**Files:** Create `public/review.html`, `public/js/pages/review.js`; modify `public/css/app.css`.

Shows the applicant summary, the key facts (diagnosis, the therapist's view, recommended programs, **safety flags**), a "Read full application (11 sections)" link, the routing slip, a comment box with the hint *"Needed if you send back or reject."*, and the decision buttons in the order `availableActions` returns.

- Buttons come from `SC_Workflow.availableActions(status, ctx)`, never from a hard-coded list.
- **Confirmations in plain language, before every action** (main §12): approve reads *"Approve and send to the Director?"* with the reviewer's own comment read back and **Yes, approve** / **No, go back**; send-back and reject name the consequence.
- Errors map through `page.errorMessage()`, so `OWN_APPLICATION`, `ALREADY_APPROVED_STAGE` and `COMMENT_REQUIRED` already read correctly in both languages.
- Browser pass: approve as Lakshmi, then send back as Suresh and confirm the comment is required.

- [x] Commit: `git commit -m "feat: add the review screen with approve, send back and reject"`

---

### Task 11: The Director's decision, and what follows

**Files:** Create `public/decision.html`, `public/js/pages/decision.js`; modify `public/css/app.css`.

In the order S7 sets out: the Admit / Waitlist choice; the **registration number preview** (`SWB/VLC/2026/0013`, from a new read-only `applications.previewRegNo` or computed client-side from `SC_Numbers` — decide when you get there, and whatever you choose, keep the number the server finally issues authoritative); the stored signature preview; **the password field** with a Show toggle; the lock note; and **Sign and admit**.

- Step-up: call `auth.prelogin` with the signed-in Director's email, take the `salt` and `iterations`, derive with `public/js/kdf.js`, send `key` with `applications.decide` (decided in "Decisions settled", #3).
- The signature image is M7. Until then the preview box says so, in the same way the form's photo field does.
- After signing, show the D1 confirmation: the registration number, "Signed by you", and the lock note.
- Browser pass: sign in as Revathi, admit the seeded application, and confirm the wrong password is refused.

- [x] Commit: `git commit -m "feat: add the Director's decision screen with password step-up"`

---

### Task 12: Sent back — the fix-and-resend view

**Files:** Modify `public/application.html`, `public/js/pages/application.js`.

When `status === "RETURNED"`, the form opens with a banner above the questions: the reviewer's name, role and date, and the comment quoted in full; a **"Steps to fix"** list of the sections that need work (each with its step number and a Fix link); the note *"When you resend, it goes to the Therapy Head again."*; and a **Fix and resend** button in place of Save & Next.

- The section list comes from `SC_FormRules.completion(values, today)`: the steps that are not `done`.
- **Fix and resend** calls `applications.submit` after flushing the autosave, and shows the T4 confirmation first (*"Send to the Therapy Head?"* with Yes, send / No, go back).
- The submit button stays hidden while `CONFIG` cannot produce a signature (M7); everything else on this screen works now.
- Browser pass: open the seeded sent-back application as Priya and confirm the comment shows and the form is editable.

- [x] Commit: `git commit -m "feat: show a sent-back application with its reviewer's comment"`

---

### Task 13: Reopen and withdraw

**Files:** Create `public/js/pages/reopen.js`, `public/js/pages/withdraw.js` (or fold both into the review/application screens if they end up small); modify `public/css/app.css`.

No mockup exists for either — the mockups' own footer lists them as still to draw. Reuse the review screen's shell.

- **Reopen** (Director or Admin, from an admitted application): a reason box, the lock note's wording, and a confirmation. Calls `applications.reopen`.
- **Withdraw** (owner or Admin, from DRAFT or RETURNED): a confirmation that says plainly that nothing is deleted, and that the family can ask again later. Calls `applications.withdraw`.
- Browser pass: reopen the admitted demo application as Revathi and confirm it returns to Priya's queue as "Sent back".

- [x] Commit: `git commit -m "feat: add the reopen and withdraw screens"`

> **As built:** only `public/js/pages/reopen.js` was created. Withdraw shipped inside the form screen's
> own file actions (`application.html`'s `#file-actions`, rendered by `pages/application.js`) — the
> second of the two options above, and the better one: the control sits on the file whose answers it
> promises not to delete. There is no `pages/withdraw.js`.

---

## Self-review

**Spec coverage.** Every M6 line in TODO.md maps to a task: My Queue (9), review screen (10), routing slip (6 for the data, 9 for the component), Approve/Send back/Reject (4, 10), sent-back view and Fix and resend (12), Director decision with step-up, signature, registration number and lock (5, 11), the five server actions (2–6), reopen and withdraw screens (13), the form fingerprint (1). The demo seed (7) was added by decision, not by the spec.

**Known holes, deliberately left:**
- The **signature upload** and the **photo** are M7. Task 11's preview and Task 12's submit button both stop at "available in a later update", exactly as the form already does.
- **Reopen keeps the registration number** (Decision #5). This interacts with the still-open question in TODO.md about whether a reopened application repeats every approval, and should be re-checked when that is settled.
**Resolved during the pre-flight scan** (see the ledger for the full table): `applications.list` carried neither `dob` nor `gender`, so Task 9 now starts by adding both to `listItem` and working the age out on the client. Five other conflicts between a task's own tests and its own code were found and fixed in place: `submit` now checks who may act before what the answers say (else a non-owner got `VALIDATION_FAILED` instead of `NOT_ALLOWED`); the sent-back test saves at `version: 4`, not 3, because submit, approve and send-back each bump it; the Director's **Reject** goes through `review`, not `decide`, since rejecting is not signing; and a Centre Head reopening someone else's admitted application gets `NOT_ALLOWED`, not `NOT_FOUND`, because he is allowed to see it.

---

## Carry-forwards recorded at M6 close-out

Four things the milestone settled that no tracked file said, copied here from the milestone ledger so
they travel with the repository rather than with one developer's working copy. Each one is a rule for
work that has not started yet.

**1. Two-role staffing is a requirement, not just a UI gap.** Main spec §4 forbids one person approving
two stages of the same round, so if the only holder of a later reviewing role also approved an earlier
stage of that application, **nobody can move it**: `REVIEWER[PENDING_DIRECTOR]` is `DIRECTOR`, and an
Admin is refused there unless they also carry `DIRECTOR`. This is inherent to `shared/workflow.js` and
predates M6, so no code change is proposed — but it belongs in the POC close-out checklist as an
operational ask: **each reviewing stage needs at least one person who has not already approved that
round.** The demo seed cannot show the gap, because every demo person holds exactly one role.

**2. Carry into M8: a rejection's date comes from its `Approvals` row, not from `decided_at`.** A
rejection goes through `applications.review`, not `decide`, so a rejected application has no
`decided_at` — and stamping it there would make a Director-scoped field mean "when any reviewer made a
terminal decision", which is the ambiguity `decided_at` was narrowed to avoid. Every decision's action,
reviewer and time is already on the routing slip, so the turnaround report (R5) must take a
rejection's date from it. A report that reads `decided_at` instead shows a blank column rather than
wrong data.

**3. `[PROD]` The port must hash the same normalized serialization the POC does.** Main spec §5 promises
that "any later change can be detected" from the SHA-256 stored with an approval. Main spec §8 names
the production column `form_json`, which has no POC counterpart: the POC keeps one Sheet column per
question, and `SC_Applications.formHash` reconstructs the object through `formValues(row)` in
`SC_FormSchema.allFields()` order. If the port hashes a differently-shaped object, an approval taken
before the port and a change made after it cannot be compared with each other, and the promise breaks
silently at the moment of the port. (No POC impact.)

**4. The Tamil review list is 28 keys, not the 10 first recorded.** Task 8's block above accounts for 58
of the 86 keys it added; the other 28 shipped without ever appearing in the plan, so nothing has
reviewed their Tamil — and, unlike the ten whose *wording* an implementer wrote for a key the plan did
name, these names were never in front of a reviewer at all. They were found by diffing this plan's Task
8 key block against `public/i18n/en.json` at `c00f12e` (before M6c: 113 keys) and at `91bbd68` (the
milestone's last commit: 199 keys — Task 8 shipped 171 of them, the screens after it the rest):

`action.reopen`, `action.signAndWaitlist`, `common.and`, `common.refresh`,
`confirm.approveToCentreHead`, `confirm.decideWaitlistTitle`, `confirm.rejectBody`,
`confirm.rejectTitle`, `confirm.reopenBody`, `confirm.reopenTitle`, `confirm.sendBackBody`,
`confirm.sendBackTitle`, `confirm.yesReject`, `confirm.yesReopen`, `confirm.yesSendBack`,
`confirm.yesSign`, `confirm.yesWithdraw`, `decide.regNoKept`, `decide.regNoPreview`,
`decide.sendBackInstead`, `decide.waitlisted`, `queue.ageYears`, `queue.waitingOne`, `reopen.done`,
`reopen.reasonMissing`, `review.noSafety`, `sentBack.by`, `sentBack.fix`.

Three of the sentences those keys hold have since been re-decided, so the Tamil reviewer should read
the list against the file as it stands rather than against this milestone's end: `queue.waitingOne` has
been deleted (the queue sentence no longer carries a number, so it needs no singular form to go with
it), `queue.ageYears` has become `queue.age` and now shows months (`{y} yrs {m} mths`, as mockup S6
draws it), and `review.title`, `common.open` and `home.comingSoon` were removed as keys with nothing
left to claim. `common.printReport` stays: M8's report screen is what it was written for.

Also settled at close-out, and worth stating because two of them were recorded in the ledger the wrong
way round: `approversThisRound`'s `>=` **is** pinned by the two dual-role tests, which never tick the
clock (so no test change was ever owed for it), and an Admin's reopen keeps `stage: "DIRECTOR"` on its
`Approvals` row — that data is right — while the role a screen names comes from the payload's `role`
field, because the therapist's banner used to read "Anand (Director)" for an Admin who holds no such
role.

**M7a added fourteen more keys to this list** (`sign.*`, the consent signature): `sign.hint`,
`sign.clear`, `sign.save`, `sign.saved`, `sign.saving`, `sign.blank`, `sign.failed`, `sign.changedOne`,
`sign.changedMany`, `sign.field.s11_consent`, `sign.field.s11_parent_name`,
`sign.field.s11_relationship`, `sign.field.s2_full_name`, `sign.field.s2_dob`. The Tamil is a first
draft, like every key above; the reviewer should read it against the file.
