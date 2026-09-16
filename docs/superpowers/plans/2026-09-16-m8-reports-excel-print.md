# M8 — Reports, Excel and Print — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six management reports (R2–R7) — filters, CSS bar charts, a Download-Excel button — plus an A4 printable Individual Assessment Report and the in-browser Excel builder that M9's backups will reuse.

**Architecture:** The maths lives in `shared/reports.js` (`SC_Reports`, pure functions over plain rows) and is called by `poc/apps-script/Reports.gs` (`SC_ReportsApi`, the `reports.get` handler) — the browser only renders and builds the file (design D1). One `reports.html` hosts R3–R7 behind a report picker; R2 is `print.html` (D2). A per-report role table layered on the `reports.view` gate, plus centre-scoping for Heads, is enforced server-side (D3). Excel is SpreadsheetML wrapped in a ZIP with a correct CRC32, built entirely in the browser (`public/js/xlsx.js`).

**Tech Stack:** Plain JavaScript, zero dependencies. Shared modules are classic IIFEs with a `module.exports` guard; `public/js/*.js` are ES modules; Apps Script `.gs` files run in the Node test harness (`node:vm` + fakes). Tests use `node:test` + `assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-16-m8-reports-excel-print-design.md`

## Global Constraints

- Every file starts with a scope header: `// scope: shared` (shared/poc) for `.js`/`.gs`, `<!-- scope: shared -->` for `.html`, `/* scope: shared */` for `.css`. `scripts/check-scope.mjs` bans platform APIs from `shared/` only — `public/js/xlsx.js` is `scope: shared` but *not* in `shared/`, so it may use `Blob`/`TextEncoder`/`document`/`URL`.
- Zero runtime dependencies (`package.json` has none). Node `>=20`.
- Shared modules use the IIFE pattern: `var SC_X = (function () { "use strict"; … })();` ending with `if (typeof module !== "undefined" && module.exports) module.exports = SC_X;`. Cross-references use `function dates() { return typeof SC_Dates !== "undefined" ? SC_Dates : require("./dates.js"); }`.
- **Naming collision:** `shared/reports.js` and `poc/apps-script/Reports.gs` share the Apps Script global namespace, so they cannot both define `SC_Reports`. The shared maths is `SC_Reports`; the POC handler is `SC_ReportsApi`.
- Every user-facing string is an i18n key in `public/i18n/en.json` **and** `public/i18n/ta.json` (flat dotted keys; `t(key, vars)` interpolates `{var}`). Reuse existing keys (`common.printReport`, `status.*`, `role.*`, `action.*`, `queue.waitingDays`) rather than adding duplicates.
- TDD: write the failing test first, watch it fail, then implement. Tests live in `tests/shared/*.test.js` (CommonJS `require`), `tests/poc/*.test.js` (CommonJS), `tests/public/*.test.mjs` (ESM `import`). `npm test` = `check-scope` then `node --test`.
- The demo staff (from `tests/poc/people.js`): `anand`=ADMIN, `priya`/`deepa`=THERAPIST, `lakshmi`=THERAPY_HEAD, `suresh`=CENTRE_HEAD, `revathi`=DIRECTOR. `setupPeople()` returns `{ ctx, tokens, as }`; `as(name)(action, data)` calls the server. `ctx.SC_Store` exposes `all/filter/find/insert/update/newId/nowIso/todayIso`.
- `SC_Auth.sessionFor` re-reads the Users row on every request, so a test may `SC_Store.update("Users", id, { centre })` after login and the next call sees it.

## File Structure

**Created:**
- `shared/reports.js` — `SC_Reports`, pure report maths (age bands, register, monthly, waitlist, demographics, turnaround). Single source of truth for bucket definitions.
- `tests/shared/reports.test.js` — unit tests for the maths.
- `poc/apps-script/Reports.gs` — `SC_ReportsApi`, the `reports.get` handler: role table, centre scope, filters, paging, print report.
- `tests/poc/reports.test.js` — integration tests (role matrix, scoping, filters, paging, print).
- `public/js/xlsx.js` — `buildXlsx`, `downloadXlsx`, `crc32` (ES module).
- `tests/public/xlsx.test.mjs` — CRC32 vector, ZIP/deflate round-trip, UTF-8 Tamil, escaping.
- `public/reports.html` + `public/js/pages/reports.js` — the reports screen (R3–R7).
- `public/print.html` + `public/js/pages/print.js` + `public/css/print.css` — the A4 report (R2).

**Modified:**
- `poc/scripts/source-order.mjs` — add `"reports"` to `SHARED_ORDER`.
- `public/css/app.css` — append the report-table and CSS-bar styles.
- `public/i18n/en.json` + `public/i18n/ta.json` — add `reports.*`, `print.*`, `nav.reports` keys.
- `public/home.html` + `public/js/pages/home.js` — a gated "Reports" bottom-nav link.
- `public/review.html` + `public/js/pages/review.js` — a print link.
- `public/decision.html` + `public/js/pages/decision.js` — a print link on the signed screen.

---

### Task 1: `shared/reports.js` — the row-shaped reports

**Files:**
- Create: `shared/reports.js`
- Modify: `poc/scripts/source-order.mjs`
- Test: `tests/shared/reports.test.js`

**Interfaces:**
- Consumes: `SC_Dates.ageFrom(dob, today)`, `SC_Dates.daysBetween(from, to)`; `SC_FormSchema.OPTIONS.GENDER/CONDITIONS/UDID/INCOME` (each `{ value, en, ta }`).
- Produces (used by Task 3 and Task 5):
  - `SC_Reports.AGE_BANDS` — frozen `[{ id, en, ta, min, max }]`, `max` null means open-ended.
  - `SC_Reports.OVERDUE_DAYS` — `7`.
  - `SC_Reports.ageBandFor(years)` → band object (falls back to the last band).
  - `SC_Reports.registerRows(rows, names, today)` → `[{ id, appNo, registrationNo, name, age, gender, centre, status, therapist, submitted, suitability }]`, newest-submitted first.
  - `SC_Reports.monthlyByCentre(rows)` → `[{ centre, month, submitted, admitted, waitlisted, rejected }]`, centre then month ascending.
  - `SC_Reports.waitlist(rows, names)` → `[{ id, appNo, name, centre, programs, waitlistedOn, therapist }]`, newest-waitlist first.
  - `SC_Reports.demographics(rows, today, bandId?)` → `{ age, gender, conditions, udid, income }`, each an array `[{ id, en, ta, count }]` over the schema's own option lists (age over `AGE_BANDS`).

Rows are **Store rows** — the Applications tab stores every form answer as its own column, so `row.app_no`, `row.registration_no`, `row.applicant_name`, `row.dob`, `row.gender`, `row.suitability`, `row.programs` (already a decoded array), `row.created_by`, `row.submitted_at`, `row.decided_at`, `row.s3_income`, `row.s2_udid_status`, `row.s4_conditions` (decoded array) are all directly readable.

- [x] **Step 1: Write the failing test**

```js
// tests/shared/reports.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const SC_Reports = require("../../shared/reports.js");

const TODAY = "2026-09-16";

function app(overrides) {
  return Object.assign({
    id: "a1", app_no: "APP-2026-0001", registration_no: null, centre: "VLC", status: "ADMITTED",
    applicant_name: "Arjun Karthik", dob: "2020-03-14", gender: "MALE", suitability: "SUITABLE",
    programs: ["SPECIAL_EDUCATION"], created_by: "u-priya", submitted_at: "2026-09-01",
    decided_at: "2026-09-10", s3_income: "FROM_10K_TO_25K", s2_udid_status: "APPLIED",
    s4_conditions: ["ADHD"], version: 1, created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-10T09:00:00.000Z",
  }, overrides);
}

test("ageBandFor places ages at the band boundaries", () => {
  assert.equal(SC_Reports.ageBandFor(0).id, "0-3");
  assert.equal(SC_Reports.ageBandFor(3).id, "0-3");
  assert.equal(SC_Reports.ageBandFor(4).id, "4-6");
  assert.equal(SC_Reports.ageBandFor(17).id, "13-17");
  assert.equal(SC_Reports.ageBandFor(18).id, "18+");
  assert.equal(SC_Reports.ageBandFor(40).id, "18+");
});

test("registerRows computes age, maps the therapist name and sorts newest first", () => {
  const names = { "u-priya": "Priya", "u-deepa": "Deepa" };
  const rows = SC_Reports.registerRows([
    app({ id: "a1", submitted_at: "2026-09-01", applicant_name: "Arjun" }),
    app({ id: "a2", app_no: "APP-2026-0002", submitted_at: "2026-09-05", dob: "2007-01-01", created_by: "u-deepa", applicant_name: "Bala" }),
  ], names, TODAY);
  assert.equal(rows[0].id, "a2"); // newest submitted first
  assert.equal(rows[0].age, 19);
  assert.equal(rows[0].therapist, "Deepa");
  assert.equal(rows[1].age, 6);
  assert.equal(rows[1].registrationNo, null);
});

test("monthlyByCentre groups by centre and submission month with outcomes", () => {
  const rows = SC_Reports.monthlyByCentre([
    app({ centre: "VLC", status: "ADMITTED", submitted_at: "2026-09-02" }),
    app({ centre: "VLC", status: "WAITLISTED", submitted_at: "2026-09-20" }),
    app({ centre: "VLC", status: "REJECTED", submitted_at: "2026-10-01" }),
    app({ centre: "SLR", status: "ADMITTED", submitted_at: "2026-09-05" }),
    app({ centre: "VLC", status: "DRAFT", submitted_at: null }),
  ]);
  assert.deepEqual(rows, [
    { centre: "SLR", month: "2026-09", submitted: 1, admitted: 1, waitlisted: 0, rejected: 0 },
    { centre: "VLC", month: "2026-09", submitted: 2, admitted: 1, waitlisted: 1, rejected: 0 },
    { centre: "VLC", month: "2026-10", submitted: 1, admitted: 0, waitlisted: 0, rejected: 1 },
  ]);
});

test("waitlist returns only waitlisted applicants newest first", () => {
  const rows = SC_Reports.waitlist([
    app({ id: "a1", status: "ADMITTED" }),
    app({ id: "a2", status: "WAITLISTED", decided_at: "2026-09-08" }),
    app({ id: "a3", status: "WAITLISTED", decided_at: "2026-09-12" }),
  ], { "u-priya": "Priya" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "a3");
  assert.equal(rows[0].waitlistedOn, "2026-09-12");
  assert.deepEqual(rows[1].programs, ["SPECIAL_EDUCATION"]);
});

test("demographics tallies age bands and the schema option lists", () => {
  const d = SC_Reports.demographics([
    app({ dob: "2020-03-14", gender: "MALE", s2_udid_status: "APPLIED", s3_income: "FROM_10K_TO_25K", s4_conditions: ["ADHD", "EPILEPSY"] }),
    app({ dob: "2007-01-01", gender: "FEMALE", s2_udid_status: "HAVE", s3_income: "ABOVE_50K", s4_conditions: [] }),
  ], TODAY);
  assert.deepEqual(d.age.map((b) => [b.id, b.count]), [["0-3", 0], ["4-6", 1], ["7-12", 0], ["13-17", 0], ["18+", 1]]);
  assert.equal(d.gender.find((g) => g.id === "MALE").count, 1);
  assert.equal(d.gender.find((g) => g.id === "FEMALE").count, 1);
  assert.equal(d.conditions.find((c) => c.id === "ADHD").count, 1);
  assert.equal(d.conditions.find((c) => c.id === "EPILEPSY").count, 1);
  assert.equal(d.udid.find((u) => u.id === "APPLIED").count, 1);
  assert.equal(d.udid.find((u) => u.id === "HAVE").count, 1);
  assert.equal(d.income.find((i) => i.id === "ABOVE_50K").count, 1);
});

test("demographics narrows to one age band when asked", () => {
  const d = SC_Reports.demographics([
    app({ id: "a1", dob: "2020-03-14" }), // 6 → "4-6"
    app({ id: "a2", dob: "2007-01-01" }), // 19 → "18+"
  ], TODAY, "18+");
  assert.deepEqual(d.age.map((b) => [b.id, b.count]), [["0-3", 0], ["4-6", 0], ["7-12", 0], ["13-17", 0], ["18+", 1]]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/shared/reports.test.js`
Expected: FAIL — `Cannot find module '../../shared/reports.js'`.

- [x] **Step 3: Write the implementation**

```js
// scope: shared
/* Management reports (main spec §7): pure maths over plain application rows and approvals.
   The bucket definitions — the age bands and the overdue threshold — live here alone, so Phase 1's
   SQL reproduces them from one source (design D1). No platform APIs: rows and approvals come in,
   summaries go out. Rows are the Applications tab's own columns, so every form answer is read
   directly (s3_income, s2_udid_status, s4_conditions). */
var SC_Reports = (function () {
  "use strict";

  function dates() { return typeof SC_Dates !== "undefined" ? SC_Dates : require("./dates.js"); }
  function schema() { return typeof SC_FormSchema !== "undefined" ? SC_FormSchema : require("./form-schema.js"); }

  var AGE_BANDS = Object.freeze([
    { id: "0-3", en: "0–3 years", ta: "0–3 வயது", min: 0, max: 3 },
    { id: "4-6", en: "4–6 years", ta: "4–6 வயது", min: 4, max: 6 },
    { id: "7-12", en: "7–12 years", ta: "7–12 வயது", min: 7, max: 12 },
    { id: "13-17", en: "13–17 years", ta: "13–17 வயது", min: 13, max: 17 },
    { id: "18+", en: "18 and above", ta: "18 மற்றும் மேல்", min: 18, max: null },
  ]);

  var OVERDUE_DAYS = 7;

  function ageYears(dob, today) {
    if (!dob) return null;
    try { return dates().ageFrom(dob, today).years; } catch (err) { return null; }
  }

  function ageBandFor(years) {
    var found = AGE_BANDS.find(function (b) { return years >= b.min && (b.max === null || years <= b.max); });
    return found || AGE_BANDS[AGE_BANDS.length - 1];
  }

  function monthOf(iso) {
    return typeof iso === "string" && iso.length >= 7 ? iso.slice(0, 7) : null;
  }

  function registerRows(rows, names, today) {
    return rows.map(function (row) {
      return {
        id: row.id, appNo: row.app_no || "", registrationNo: row.registration_no || "",
        name: row.applicant_name || "", age: ageYears(row.dob, today), gender: row.gender || null,
        centre: row.centre || null, status: row.status, therapist: (names && names[row.created_by]) || "",
        submitted: row.submitted_at || null, suitability: row.suitability || null,
      };
    }).sort(function (a, b) {
      var sa = a.submitted || "", sb = b.submitted || "";
      if (sa === sb) return 0;
      return sa < sb ? 1 : -1;
    });
  }

  function monthlyByCentre(rows) {
    var map = {};
    rows.forEach(function (row) {
      var month = monthOf(row.submitted_at);
      if (!month) return;
      var key = row.centre + "
      var cell = map[key] || { centre: row.centre, month: month, submitted: 0, admitted: 0, waitlisted: 0, rejected: 0 };
      cell.submitted += 1;
      if (row.status === "ADMITTED") cell.admitted += 1;
      else if (row.status === "WAITLISTED") cell.waitlisted += 1;
      else if (row.status === "REJECTED") cell.rejected += 1;
      map[key] = cell;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (a.centre !== b.centre) return a.centre < b.centre ? -1 : 1;
      return a.month < b.month ? -1 : 1;
    });
  }

  function waitlist(rows, names) {
    return rows.filter(function (row) { return row.status === "WAITLISTED"; })
      .map(function (row) {
        return {
          id: row.id, appNo: row.app_no || "", name: row.applicant_name || "", centre: row.centre || null,
          programs: Array.isArray(row.programs) ? row.programs : [], waitlistedOn: row.decided_at || null,
          therapist: (names && names[row.created_by]) || "",
        };
      })
      .sort(function (a, b) {
        var wa = a.waitlistedOn || "", wb = b.waitlistedOn || "";
        if (wa === wb) return 0;
        return wa < wb ? 1 : -1;
      });
  }

  function tally(values, list) {
    var counts = {};
    list.forEach(function (o) { counts[o.value] = 0; });
    (values || []).forEach(function (v) {
      if (Object.prototype.hasOwnProperty.call(counts, v)) counts[v] += 1;
    });
    return list.map(function (o) { return { id: o.value, en: o.en, ta: o.ta, count: counts[o.value] }; });
  }

  function demographics(rows, today, bandId) {
    var scoped = bandId
      ? rows.filter(function (r) {
          var y = ageYears(r.dob, today);
          return y !== null && ageBandFor(y).id === bandId;
        })
      : rows;
    return {
      age: tally(scoped.map(function (r) {
        var y = ageYears(r.dob, today);
        return y === null ? null : ageBandFor(y).id;
      }), AGE_BANDS.map(function (b) { return { value: b.id, en: b.en, ta: b.ta }; })),
      gender: tally(scoped.map(function (r) { return r.gender; }), schema().OPTIONS.GENDER),
      conditions: tally(
        scoped.reduce(function (acc, r) { return acc.concat(Array.isArray(r.s4_conditions) ? r.s4_conditions : []); }, []),
        schema().OPTIONS.CONDITIONS
      ),
      udid: tally(scoped.map(function (r) { return r.s2_udid_status; }), schema().OPTIONS.UDID),
      income: tally(scoped.map(function (r) { return r.s3_income; }), schema().OPTIONS.INCOME),
    };
  }

  return Object.freeze({
    AGE_BANDS: AGE_BANDS,
    OVERDUE_DAYS: OVERDUE_DAYS,
    ageBandFor: ageBandFor,
    registerRows: registerRows,
    monthlyByCentre: monthlyByCentre,
    waitlist: waitlist,
    demographics: demographics,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Reports;
}
```

Add `"reports"` to `poc/scripts/source-order.mjs` so the POC build loads it after its dependencies:

```js
export const SHARED_ORDER = Object.freeze([
  "dates", "numbers", "permissions", "workflow", "actions", "consent", "form-schema", "form-rules", "reports",
]);
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/shared/reports.test.js`
Expected: PASS (all six).

- [x] **Step 5: Commit**

```bash
git add shared/reports.js tests/shared/reports.test.js poc/scripts/source-order.mjs
git commit -m "feat: shared report maths (register, monthly, waitlist, demographics)"
```

---

### Task 2: `shared/reports.js` — turnaround (R5)

**Files:**
- Modify: `shared/reports.js`
- Test: `tests/shared/reports.test.js`

**Interfaces:**
- Consumes: `SC_Dates.daysBetween(from, to)`; rows and approvals (plain objects) from Task 3.
- Produces (used by Task 3):
  - `SC_Reports.rejectionDate(applicationId, approvals)` → the `created_at` of the latest `REJECT` approval, or `null` (a rejection never writes `decided_at`).
  - `SC_Reports.turnaround(rows, approvals, names, today)` → `{ pending, avgDaysPerStage }` where `pending` is `[{ id, appNo, name, centre, status, daysInStage, overdue }]` (most days-in-stage first) and `avgDaysPerStage` is `[{ stage, avgDays }]` over `THERAPY_HEAD`, `CENTRE_HEAD`, `DIRECTOR` (`avgDays` null when no leg completed).

- [x] **Step 1: Write the failing test (append to the same file)**

```js
function approval(id, stage, action, createdAt) {
  return { application_id: id, stage: stage, action: action, created_at: createdAt };
}

test("rejectionDate reads the Approvals row, not decided_at", () => {
  const approvals = [approval("a1", "DIRECTOR", "REJECT", "2026-09-10T10:00:00.000Z")];
  const rejected = app({ id: "a1", status: "REJECTED", decided_at: null });
  assert.equal(SC_Reports.rejectionDate("a1", approvals), "2026-09-10T10:00:00.000Z");
  assert.equal(rejected.decided_at, null); // the field a rejection never writes
  assert.equal(SC_Reports.rejectionDate("a2", approvals), null);
});

test("turnaround lists waiting files most-overdue first and flags overdue", () => {
  const approvals = [approval("a1", "THERAPY_HEAD", "APPROVE", "2026-09-10T10:00:00.000Z")];
  const rows = [
    app({ id: "a1", status: "PENDING_CENTRE_HEAD", submitted_at: "2026-09-01" }),
    app({ id: "a2", status: "PENDING_THERAPY_HEAD", submitted_at: "2026-09-15" }),
    app({ id: "a3", status: "ADMITTED" }), // not in flight
    app({ id: "a9", status: "PENDING_DIRECTOR", submitted_at: "2026-08-01" }),
  ];
  const more = [approval("a9", "CENTRE_HEAD", "APPROVE", "2026-08-05T10:00:00.000Z")];
  const turn = SC_Reports.turnaround(rows, approvals.concat(more), {}, TODAY);
  assert.equal(turn.pending.length, 3);
  assert.equal(turn.pending[0].id, "a9"); // 42 days in stage
  assert.equal(turn.pending[0].daysInStage, 42);
  assert.equal(turn.pending[0].overdue, true);
  assert.equal(turn.pending[1].id, "a1"); // 6 days
  assert.equal(turn.pending[1].daysInStage, 6);
  assert.equal(turn.pending[1].overdue, false);
  assert.equal(turn.pending[2].id, "a2"); // 1 day
});

test("avgDaysPerStage averages each completed stage's span", () => {
  const approvals = [
    approval("a1", "THERAPY_HEAD", "APPROVE", "2026-09-03T10:00:00.000Z"),
    approval("a1", "CENTRE_HEAD", "APPROVE", "2026-09-06T10:00:00.000Z"),
    approval("a1", "DIRECTOR", "ADMIT", "2026-09-11T10:00:00.000Z"),
  ];
  const rows = [app({ id: "a1", status: "ADMITTED", submitted_at: "2026-09-01", decided_at: "2026-09-11" })];
  const avg = SC_Reports.turnaround(rows, approvals, {}, TODAY).avgDaysPerStage;
  assert.deepEqual(avg, [
    { stage: "THERAPY_HEAD", avgDays: 2 },   // 09-01 → 09-03
    { stage: "CENTRE_HEAD", avgDays: 3 },    // 09-03 → 09-06
    { stage: "DIRECTOR", avgDays: 5 },       // 09-06 → 09-11
  ]);
});
```

- [x] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/shared/reports.test.js`
Expected: FAIL — `SC_Reports.rejectionDate is not a function` / `SC_Reports.turnaround is not a function`.

- [x] **Step 3: Implement (append before the `return` in `shared/reports.js`)**

```js
  var PENDING_STATUSES = Object.freeze(["PENDING_THERAPY_HEAD", "PENDING_CENTRE_HEAD", "PENDING_DIRECTOR", "RETURNED", "WAITLISTED"]);
  var STAGES = Object.freeze(["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);

  // A rejection's date lives in its Approvals row: decide() writes decided_at only for ADMIT and
  // WAITLIST, so a rejected file's decided_at is always null (M6 plan, carry-forward 2).
  function rejectionDate(applicationId, approvals) {
    var rows = (approvals || []).filter(function (r) {
      return r.application_id === applicationId && r.action === "REJECT";
    });
    if (rows.length === 0) return null;
    return rows.reduce(function (latest, r) { return r.created_at > latest.created_at ? r : latest; }).created_at;
  }

  // Which reviewing stage an approval completed, if any. SEND_BACK and REOPEN leave the file where
  // it is, so they complete nothing; a Director's ADMIT or WAITLIST completes the last stage.
  function completingStage(stage, action) {
    if (action === "APPROVE") return stage;
    if (action === "ADMIT" || action === "WAITLIST") return "DIRECTOR";
    if (action === "REJECT") return stage;
    return null;
  }

  // The days a file spent in each reviewing stage, one leg per completion. A leg runs from the
  // previous milestone — the submission, then each completed stage — to that stage's completion.
  // A SEND_BACK is not a milestone, so a leg across a resubmission is measured from the previous
  // completed stage; exact per-round timing is out of scope for this POC average.
  function stageSpans(row, approvals) {
    var events = [];
    if (row.submitted_at) events.push({ at: row.submitted_at, stage: null });
    (approvals || []).filter(function (r) { return r.application_id === row.id; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; })
      .forEach(function (r) { events.push({ at: r.created_at, stage: completingStage(r.stage, r.action) }); });
    var spans = { THERAPY_HEAD: [], CENTRE_HEAD: [], DIRECTOR: [] };
    var last = null;
    events.forEach(function (e) {
      if (e.stage && last) spans[e.stage].push(dates().daysBetween(last.slice(0, 10), e.at.slice(0, 10)));
      if (e.stage || last === null) last = e.at;
    });
    return spans;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function avgDaysPerStage(rows, approvals) {
    var sums = { THERAPY_HEAD: 0, CENTRE_HEAD: 0, DIRECTOR: 0 };
    var counts = { THERAPY_HEAD: 0, CENTRE_HEAD: 0, DIRECTOR: 0 };
    rows.forEach(function (row) {
      var spans = stageSpans(row, approvals);
      STAGES.forEach(function (stage) {
        spans[stage].forEach(function (d) { sums[stage] += d; counts[stage] += 1; });
      });
    });
    return STAGES.map(function (stage) {
      return { stage: stage, avgDays: counts[stage] === 0 ? null : round1(sums[stage] / counts[stage]) };
    });
  }

  function lastApprovalAt(applicationId, approvals) {
    var rows = (approvals || []).filter(function (r) { return r.application_id === applicationId; });
    if (rows.length === 0) return null;
    return rows.reduce(function (latest, r) { return r.created_at > latest.created_at ? r : latest; }).created_at;
  }

  // The current stage began at the latest of the submission, the decision, and the last review
  // action — ISO strings sort as their dates, so the max is the right anchor for a file that was
  // sent back and resubmitted.
  function stageSince(row, approvals) {
    return [row.submitted_at, row.decided_at, lastApprovalAt(row.id, approvals)]
      .filter(Boolean).sort().pop() || null;
  }

  function turnaround(rows, approvals, names, today) {
    var pending = rows
      .filter(function (row) { return PENDING_STATUSES.indexOf(row.status) !== -1; })
      .map(function (row) {
        var since = stageSince(row, approvals);
        var days = since ? dates().daysBetween(since, today) : null;
        return {
          id: row.id, appNo: row.app_no || "", name: row.applicant_name || "", centre: row.centre || null,
          status: row.status, daysInStage: days, overdue: days !== null && days > OVERDUE_DAYS,
        };
      })
      .sort(function (a, b) {
        var da = a.daysInStage === null ? -1 : a.daysInStage;
        var db = b.daysInStage === null ? -1 : b.daysInStage;
        return db - da;
      });
    return { pending: pending, avgDaysPerStage: avgDaysPerStage(rows, approvals) };
  }
```

And add `rejectionDate` and `turnaround` to the `return Object.freeze({ … })` list.

- [x] **Step 4: Run the tests**

Run: `node --test tests/shared/reports.test.js`
Expected: PASS (all twelve).

- [x] **Step 5: Commit**

```bash
git add shared/reports.js tests/shared/reports.test.js
git commit -m "feat: turnaround report (pending, days-in-stage, avg per stage)"
```

---

### Task 3: `poc/apps-script/Reports.gs` — the `reports.get` handler

**Files:**
- Create: `poc/apps-script/Reports.gs`
- Test: `tests/poc/reports.test.js`

**Interfaces:**
- Consumes: `SC_Actions.ok/fail`, `SC_Store.all/filter/find/todayIso`, `SC_Reports.*` (Tasks 1–2), `SC_Applications.get({ id }, session)` (returns the full envelope with `data.approvals` where each row is `{ stage, action, comment, role, userId, userName, at }`), `Utilities.base64Encode`, `DriveApp.getFileById(id).getBlob().getBytes()`.
- Produces (used by Task 5 and Task 6):
  - `SC_ReportsApi.get(data, session)` registered as `reports.get`.
  - `data = { name, filters?, page?, id? }`. Row-shaped reports return `{ items, page, pageSize: 50, total }` (matching `applications.list`). `monthly` returns `{ items }`; `turnaround` returns `{ pending, avgDaysPerStage }`; `demographics` returns `{ age, gender, conditions, udid, income }`; `print` returns `{ app, signature, signerName, signedAt }`.

- [x] **Step 1: Write the failing test**

```js
// tests/poc/reports.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

// The signature-pad's PNG sniff only checks the magic bytes, so the 8-byte header is a valid
// signature for the fake Drive (M7b's signatures.test.js uses the same constant).
const SIG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

function seedApp(ctx, overrides) {
  return ctx.SC_Store.insert("Applications", Object.assign({
    id: ctx.SC_Store.newId(), app_no: "APP-2026-0001", registration_no: null, centre: "VLC",
    status: "ADMITTED", applicant_name: "Arjun Karthik", dob: "2020-03-14", gender: "MALE",
    suitability: "SUITABLE", programs: ["SPECIAL_EDUCATION"], created_by: "u-priya",
    submitted_at: "2026-09-01T09:00:00.000Z", decided_at: "2026-09-10T09:00:00.000Z",
    version: 1, created_at: "2026-09-01T09:00:00.000Z", updated_at: "2026-09-10T09:00:00.000Z",
    s3_income: "FROM_10K_TO_25K", s2_udid_status: "APPLIED", s4_conditions: ["ADHD"],
  }, overrides));
}

test("a therapist has no reports.view, so reports.get refuses them", () => {
  const { as } = setupPeople();
  assert.equal(as("priya")("reports.get", { name: "register" }).error.code, "NOT_ALLOWED");
});

test("the per-report role table decides which names a role may ask", () => {
  const { as } = setupPeople();
  assert.equal(as("suresh")("reports.get", { name: "monthly" }).error.code, "NOT_ALLOWED");   // R4 is Director/Admin
  assert.equal(as("suresh")("reports.get", { name: "turnaround" }).error.code, "NOT_ALLOWED"); // R5 is Director only
  assert.equal(as("suresh")("reports.get", { name: "waitlist" }).ok, true);                   // R6 includes Centre Head
  assert.equal(as("suresh")("reports.get", { name: "register" }).ok, true);
  assert.equal(as("revathi")("reports.get", { name: "turnaround" }).ok, true);                // Director sees all
  assert.equal(as("anand")("reports.get", { name: "register" }).ok, true);                    // Admin sees R3
  assert.equal(as("anand")("reports.get", { name: "waitlist" }).error.code, "NOT_ALLOWED");   // Admin does not see R6
});

test("centre scoping: a Head sees only their centre, the Director sees all", () => {
  const { ctx, as } = setupPeople();
  seedApp(ctx, { centre: "VLC" });
  seedApp(ctx, { centre: "SLR", app_no: "APP-2026-0002" });
  ctx.SC_Store.update("Users", "u-lakshmi", { centre: "VLC" });
  ctx.SC_Store.update("Users", "u-suresh", { centre: "SLR" });
  const lak = as("lakshmi")("reports.get", { name: "register" });
  assert.equal(lak.data.total, 1);
  assert.equal(lak.data.items[0].centre, "VLC");
  const rev = as("revathi")("reports.get", { name: "register" });
  assert.equal(rev.data.total, 2);
});

test("filters narrow the rows and paging of 50 is applied", () => {
  const { ctx, as } = setupPeople();
  seedApp(ctx, { status: "WAITLISTED" });
  seedApp(ctx, { status: "ADMITTED", app_no: "APP-2026-0002" });
  const res = as("revathi")("reports.get", { name: "register", filters: { status: "WAITLISTED" } });
  assert.equal(res.data.total, 1);
  assert.equal(res.data.items[0].status, "WAITLISTED");
  assert.equal(res.data.pageSize, 50);
});

test("print returns the report, the decision trail and the Director's signature", () => {
  const { ctx, as } = setupPeople();
  assert.equal(as("revathi")("signature.upload", { base64: SIG_PNG }).ok, true);
  const app = seedApp(ctx, { status: "ADMITTED", registration_no: "SWB/VLC/2026/0001" });
  ctx.SC_Store.insert("Approvals", {
    id: ctx.SC_Store.newId(), application_id: app.id, stage: "DIRECTOR", action: "ADMIT",
    comment: null, user_id: "u-revathi", form_hash: "x", created_at: "2026-09-10T09:00:00.000Z",
  });
  const res = as("revathi")("reports.get", { name: "print", id: app.id });
  assert.equal(res.ok, true);
  assert.equal(res.data.signerName, "Revathi");
  assert.equal(res.data.signedAt, "2026-09-10T09:00:00.000Z");
  assert.equal(res.data.signature, SIG_PNG); // base64 round-trips through the fake Drive
  assert.equal(res.data.app.registrationNo, "SWB/VLC/2026/0001");
  assert.ok(Array.isArray(res.data.app.approvals));
});

test("a scoped Head cannot print another centre's file, and a therapist cannot print at all", () => {
  const { ctx, as } = setupPeople();
  ctx.SC_Store.update("Users", "u-lakshmi", { centre: "VLC" });
  const slr = seedApp(ctx, { centre: "SLR", app_no: "APP-2026-0009" });
  assert.equal(as("lakshmi")("reports.get", { name: "print", id: slr.id }).error.code, "NOT_FOUND");
  assert.equal(as("priya")("reports.get", { name: "print", id: slr.id }).error.code, "NOT_ALLOWED");
});
```

- [x] **Step 2: Run to verify the test fails**

Run: `node --test tests/poc/reports.test.js`
Expected: FAIL — `reports.get` is registered but no `.gs` handler implements it, so the router returns UNKNOWN_ACTION (or `SC_ReportsApi` is undefined).

- [x] **Step 3: Write the implementation**

```js
// scope: poc
/* Management reports (POC spec §10, main spec §7): reads rows and calls shared/reports.js for the
   maths (design D1). The per-report role table (D3) is layered on the reports.view gate the router
   already enforces, and centre-scoping is applied here — Applications.list deliberately does not
   scope, so a Head's report must, and a Director or Admin sees every centre. */
var SC_ReportsApi = (function () {
  "use strict";

  var ok = SC_Actions.ok;
  var fail = SC_Actions.fail;
  var PAGE_SIZE = 50;

  // D3: which report names each role may request (main spec §7 "For"). The broad reports.view
  // capability in the contract is the "may open reports at all" gate; this table is the finer one.
  var REPORT_ROLES = Object.freeze({
    print: ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"],
    register: ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR", "ADMIN"],
    monthly: ["DIRECTOR", "ADMIN"],
    turnaround: ["DIRECTOR"],
    waitlist: ["DIRECTOR", "CENTRE_HEAD"],
    demographics: ["DIRECTOR", "ADMIN"],
  });

  function maySee(name, roles) {
    var allowed = REPORT_ROLES[name];
    return allowed ? roles.some(function (role) { return allowed.indexOf(role) !== -1; }) : false;
  }

  // A Head is tied to one centre; a Director or Admin (centre blank) sees everything.
  function centreScoped(user) {
    return Boolean(user.centre);
  }

  function readFilters(data) {
    var f = data.filters && typeof data.filters === "object" ? data.filters : {};
    return {
      centre: typeof f.centre === "string" && f.centre ? f.centre : null,
      status: typeof f.status === "string" && f.status ? f.status : null,
      program: typeof f.program === "string" && f.program ? f.program : null,
      from: typeof f.from === "string" && f.from ? f.from : null,
      to: typeof f.to === "string" && f.to ? f.to : null,
      age: typeof f.age === "string" && f.age ? f.age : null,
    };
  }

  // Centre scope plus the requested filters. Dates compare on the "YYYY-MM-DD" part so a `to` of
  // "2026-09-05" still includes files submitted that whole day.
  function applicationsInScope(user, filters) {
    var scoped = centreScoped(user) ? user.centre : null;
    return SC_Store.filter("Applications", function (row) {
      if (scoped && row.centre !== scoped) return false;
      if (filters.centre && row.centre !== filters.centre) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.program && (!Array.isArray(row.programs) || row.programs.indexOf(filters.program) === -1)) return false;
      var d = row.submitted_at ? row.submitted_at.slice(0, 10) : null;
      if (filters.from && (!d || d < filters.from)) return false;
      if (filters.to && (!d || d > filters.to)) return false;
      return true;
    });
  }

  function nameMap() {
    return SC_Store.all("Users").reduce(function (names, user) {
      names[user.id] = user.name;
      return names;
    }, {});
  }

  function pageOf(items, page) {
    var start = (page - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }

  function paged(items, page, total) {
    return { items: items, page: page, pageSize: PAGE_SIZE, total: total };
  }

  function validPage(data) {
    var page = data.page === undefined ? 1 : data.page;
    return Number.isInteger(page) && page >= 1 ? page : null;
  }

  function register(data, session) {
    var page = validPage(data);
    if (!page) return fail("INVALID_REQUEST");
    var items = SC_Reports.registerRows(applicationsInScope(session.user, readFilters(data)), nameMap(), SC_Store.todayIso());
    return ok(paged(pageOf(items, page), page, items.length));
  }

  function monthly(data, session) {
    return ok({ items: SC_Reports.monthlyByCentre(applicationsInScope(session.user, readFilters(data))) });
  }

  function turnaround(data, session) {
    var rows = applicationsInScope(session.user, readFilters(data));
    return ok(SC_Reports.turnaround(rows, SC_Store.all("Approvals"), nameMap(), SC_Store.todayIso()));
  }

  function waitlist(data, session) {
    var page = validPage(data);
    if (!page) return fail("INVALID_REQUEST");
    var items = SC_Reports.waitlist(applicationsInScope(session.user, readFilters(data)), nameMap());
    return ok(paged(pageOf(items, page), page, items.length));
  }

  function demographics(data, session) {
    var filters = readFilters(data);
    return ok(SC_Reports.demographics(applicationsInScope(session.user, filters), SC_Store.todayIso(), filters.age));
  }

  function lastDecision(approvals) {
    var decided = approvals.filter(function (r) { return r.action === "ADMIT" || r.action === "WAITLIST"; });
    if (decided.length === 0) return null;
    return decided.reduce(function (latest, r) { return r.at > latest.at ? r : latest; });
  }

  function printReport(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    var row = SC_Store.find("Applications", "id", data.id);
    if (!row) return fail("NOT_FOUND");
    // A scoped Head may only print their own centre's file; "no such file" hides the rest.
    if (centreScoped(session.user) && row.centre !== session.user.centre) return fail("NOT_FOUND");
    var got = SC_Applications.get({ id: data.id }, session);
    if (!got.ok) return got;
    var decision = lastDecision(got.data.approvals);
    var sigRow = decision ? SC_Store.find("Signatures", "user_id", decision.userId) : null;
    var signature = null;
    if (sigRow) {
      signature = Utilities.base64Encode(DriveApp.getFileById(sigRow.drive_file_id).getBlob().getBytes());
    }
    return ok({
      app: got.data,
      signature: signature,
      signerName: decision ? decision.userName : null,
      signedAt: decision ? decision.at : null,
    });
  }

  function get(data, session) {
    var name = typeof data.name === "string" ? data.name : "";
    if (!maySee(name, session.user.roles)) return fail("NOT_ALLOWED");
    if (name === "print") return printReport(data, session);
    if (name === "register") return register(data, session);
    if (name === "monthly") return monthly(data, session);
    if (name === "turnaround") return turnaround(data, session);
    if (name === "waitlist") return waitlist(data, session);
    return demographics(data, session);
  }

  return Object.freeze({ get: get });
})();

SC_Api.register("reports.get", SC_ReportsApi.get);
```

- [x] **Step 4: Run the tests**

Run: `node --test tests/poc/reports.test.js`
Expected: PASS (all seven).

- [x] **Step 5: Run the whole suite and commit**

Run: `npm test` (scope check + every test file — the new `.gs` must pass `check-scope.mjs`).
Expected: all pass, 0 fail.

```bash
git add poc/apps-script/Reports.gs tests/poc/reports.test.js
git commit -m "feat: reports.get handler with role table, centre scope, filters and paging"
```

---

### Task 4: `public/js/xlsx.js` — the in-browser Excel builder

**Files:**
- Create: `public/js/xlsx.js`
- Test: `tests/public/xlsx.test.mjs`

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces (used by Task 5):
  - `buildXlsx(sheets)` → `Blob` where each sheet is `{ name, headers: string[], rows: string[][] }`.
  - `downloadXlsx(filename, sheets)` — triggers a browser save.
  - `crc32(bytes: Uint8Array)` → unsigned 32-bit (exported so the test can check the standard vector).

- [x] **Step 1: Write the failing test**

```js
// tests/public/xlsx.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, crc32 } from "../../public/js/xlsx.js";

function zipEntries(bytes) {
  const entries = [];
  let off = 0;
  while (off + 30 <= bytes.length && bytes[off] === 0x50 && bytes[off + 1] === 0x4b && bytes[off + 2] === 0x03 && bytes[off + 3] === 0x04) {
    const nameLen = bytes[off + 26] | (bytes[off + 27] << 8);
    const extraLen = bytes[off + 28] | (bytes[off + 29] << 8);
    const compSize = bytes[off + 18] | (bytes[off + 19] << 8) | (bytes[off + 20] << 16) | (bytes[off + 21] << 24);
    const name = new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + nameLen));
    const data = bytes.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
    entries.push({ name, data });
    off += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("buildXlsx produces a ZIP whose sheet deflate inflates to the UTF-8 XML", async () => {
  const blob = buildXlsx([{ name: "Register", headers: ["App No", "Name"], rows: [["APP-2026-0001", "அர்ஜுன்"]] }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const entries = zipEntries(bytes);
  assert.deepEqual(entries.map((e) => e.name), [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml",
  ]);
  const xml = new TextDecoder().decode(inflateRawSync(entries.find((e) => e.name === "xl/worksheets/sheet1.xml").data));
  assert.ok(xml.includes("அர்ஜுன்")); // Tamil bytes survive the round-trip
  assert.ok(xml.includes("APP-2026-0001"));
});

test("special XML characters are escaped in cells", async () => {
  const blob = buildXlsx([{ name: "S", headers: ["A"], rows: [["a < b & 'c' \"d\""]] }]);
  const entries = zipEntries(new Uint8Array(await blob.arrayBuffer()));
  const xml = new TextDecoder().decode(inflateRawSync(entries.find((e) => e.name.endsWith("sheet1.xml")).data));
  assert.ok(xml.includes("a &lt; b &amp; &apos;c&apos; &quot;d&quot;"));
});
```

- [x] **Step 2: Run to verify it fails**

Run: `node --test tests/public/xlsx.test.mjs`
Expected: FAIL — `Cannot find module '../../public/js/xlsx.js'`.

- [x] **Step 3: Write the implementation**

```js
// scope: shared
/* A tiny Excel (.xlsx) writer for the browser (main spec §11.1): SpreadsheetML folded into a ZIP.
   The deflate stream uses stored blocks — a valid DEFLATE (method 8) that every reader opens, with no
   LZ77/Huffman of our own. UTF-8 throughout, so Tamil survives. Reused later by M9's backups. */
const UTF8 = new TextEncoder();

// The standard CRC-32 (IEEE 802.3), as the ZIP central directory needs it.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A DEFLATE stream of one or more "stored" (uncompressed) blocks, the last marked final.
function deflateStored(bytes) {
  const parts = [];
  let i = 0;
  while (i < bytes.length) {
    const chunk = Math.min(bytes.length - i, 0xffff);
    const final = i + chunk >= bytes.length;
    parts.push(final ? 0x01 : 0x00);                    // BFINAL | (BTYPE = 00)
    parts.push(chunk & 0xff, (chunk >> 8) & 0xff);      // LEN
    parts.push((~chunk) & 0xff, ((~chunk) >> 8) & 0xff); // NLEN (one's complement)
    for (let j = 0; j < chunk; j++) parts.push(bytes[i + j]);
    i += chunk;
  }
  return new Uint8Array(parts);
}

function u16(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); }
function u32(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach((p) => { out.set(p, off); off += p.length; });
  return out;
}

function zipFile(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = UTF8.encode(entry.name);
    const deflated = deflateStored(entry.data);
    const crc = crc32(entry.data);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    local.push(localHeader, deflated);
    central.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(entry.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + deflated.length;
  });
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(offset), u16(0),
  ]);
  return concat([...local, ...central, eocd]);
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colName(index) {
  let name = "";
  let n = index;
  while (n >= 0) { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; }
  return name;
}

function sheetXml(sheet) {
  const headerRow = sheet.headers.map((h, c) => `<c r="${colName(c)}1" t="inlineStr"><is><t>${xmlEscape(h)}</t></is></c>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((value, c) => `<c r="${colName(c)}${r + 2}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join("");
    return `<row r="${r + 2}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headerRow}</row>${rows}</sheetData></worksheet>`;
}

function workbookXml(sheetNames) {
  const sheets = sheetNames.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function relsXml(n) {
  const rels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypesXml(n) {
  const overrides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

export function buildXlsx(sheets) {
  const entries = [
    { name: "[Content_Types].xml", data: UTF8.encode(contentTypesXml(sheets.length)) },
    { name: "_rels/.rels", data: UTF8.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: UTF8.encode(workbookXml(sheets.map((s) => s.name))) },
    { name: "xl/_rels/workbook.xml.rels", data: UTF8.encode(relsXml(sheets.length)) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: UTF8.encode(sheetXml(s)) })),
  ];
  return new Blob([zipFile(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXlsx(filename, sheets) {
  const url = URL.createObjectURL(buildXlsx(sheets));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [x] **Step 4: Run the tests**

Run: `node --test tests/public/xlsx.test.mjs`
Expected: PASS (all three).

- [x] **Step 5: Commit**

```bash
git add public/js/xlsx.js tests/public/xlsx.test.mjs
git commit -m "feat: in-browser xlsx builder (SpreadsheetML + ZIP, CRC32)"
```

---

### Task 5: The reports screen (`reports.html` + `reports.js`) and the Reports link

**Files:**
- Create: `public/reports.html`, `public/js/pages/reports.js`
- Modify: `public/css/app.css` (append styles), `public/i18n/en.json`, `public/i18n/ta.json`, `public/home.html`, `public/js/pages/home.js`

**Interfaces:**
- Consumes: `startPage`/`showMessage`/`setBusy` from `../page.js`; `buildXlsx`/`downloadXlsx` from `../xlsx.js` (Task 4); `window.SC_FormSchema.OPTIONS.CENTRE/PROGRAMS`, `window.SC_Reports.AGE_BANDS`, `window.SC_Workflow.STATUS`, `window.SC_Permissions.can`; the `reports.get` envelope from Task 3 (`{ items, page, pageSize, total }`, or `{ pending, avgDaysPerStage }`, or `{ age, gender, conditions, udid, income }`).
- Produces: the rendered R3–R7 screen and the Download-Excel files.

- [x] **Step 1: Add the i18n keys**

Append to `public/i18n/en.json` (before the closing `}`):

```json
  "nav.reports": "Reports",
  "reports.title": "Reports",
  "reports.register": "Application register",
  "reports.monthly": "Monthly summary",
  "reports.turnaround": "Pending & turnaround",
  "reports.waitlist": "Waitlist",
  "reports.demographics": "Demographics",
  "reports.download": "Download Excel",
  "reports.filters": "Filters",
  "reports.filterCentre": "Centre",
  "reports.filterFrom": "From",
  "reports.filterTo": "To",
  "reports.filterStatus": "Status",
  "reports.filterProgram": "Program",
  "reports.filterAge": "Age band",
  "reports.allCentres": "All centres",
  "reports.allStatuses": "All statuses",
  "reports.allPrograms": "All programs",
  "reports.allAges": "All ages",
  "reports.noRows": "No applications match these filters.",
  "reports.avgDays": "Average days per stage",
  "reports.days": "{n} days",
  "reports.overdue": "Overdue",
  "reports.col.appNo": "App no",
  "reports.col.regNo": "Reg no",
  "reports.col.name": "Name",
  "reports.col.age": "Age",
  "reports.col.gender": "Gender",
  "reports.col.centre": "Centre",
  "reports.col.status": "Status",
  "reports.col.therapist": "Therapist",
  "reports.col.submitted": "Submitted",
  "reports.col.suitability": "Suitability",
  "reports.col.programs": "Programs",
  "reports.col.waitlistedOn": "Waitlisted",
  "reports.col.days": "Days",
  "reports.col.month": "Month",
  "reports.col.submittedCount": "Submitted",
  "reports.col.admitted": "Admitted",
  "reports.col.waitlisted": "Waitlisted",
  "reports.col.rejected": "Rejected",
  "reports.col.count": "Count"
```

Append to `public/i18n/ta.json`:

```json
  "nav.reports": "அறிக்கைகள்",
  "reports.title": "அறிக்கைகள்",
  "reports.register": "விண்ணப்பப் பதிவேடு",
  "reports.monthly": "மாதாந்திரச் சுருக்கம்",
  "reports.turnaround": "நிலுவையும் காலமும்",
  "reports.waitlist": "காத்திருப்புப் பட்டியல்",
  "reports.demographics": "மக்கள்தொகை விவரம்",
  "reports.download": "Excel பதிவிறக்கு",
  "reports.filters": "வடிகட்டிகள்",
  "reports.filterCentre": "மையம்",
  "reports.filterFrom": "தொடக்கம்",
  "reports.filterTo": "முடிவு",
  "reports.filterStatus": "நிலை",
  "reports.filterProgram": "திட்டம்",
  "reports.filterAge": "வயது பிரிவு",
  "reports.allCentres": "அனைத்து மையங்களும்",
  "reports.allStatuses": "அனைத்து நிலைகளும்",
  "reports.allPrograms": "அனைத்துத் திட்டங்களும்",
  "reports.allAges": "அனைத்து வயதும்",
  "reports.noRows": "இந்த வடிகட்டிகளுக்கு விண்ணப்பங்கள் இல்லை.",
  "reports.avgDays": "ஒவ்வொரு நிலைக்கும் சராசரி நாட்கள்",
  "reports.days": "{n} நாட்கள்",
  "reports.overdue": "தாமதம்",
  "reports.col.appNo": "விண்ணப்ப எண்",
  "reports.col.regNo": "பதிவு எண்",
  "reports.col.name": "பெயர்",
  "reports.col.age": "வயது",
  "reports.col.gender": "பாலினம்",
  "reports.col.centre": "மையம்",
  "reports.col.status": "நிலை",
  "reports.col.therapist": "சிகிச்சையாளர்",
  "reports.col.submitted": "சமர்ப்பித்தது",
  "reports.col.suitability": "தகுதி",
  "reports.col.programs": "திட்டங்கள்",
  "reports.col.waitlistedOn": "காத்திருப்பில்",
  "reports.col.days": "நாட்கள்",
  "reports.col.month": "மாதம்",
  "reports.col.submittedCount": "சமர்ப்பிக்கப்பட்டவை",
  "reports.col.admitted": "சேர்க்கப்பட்டவை",
  "reports.col.waitlisted": "காத்திருப்பவை",
  "reports.col.rejected": "நிராகரிக்கப்பட்டவை",
  "reports.col.count": "எண்ணிக்கை"
```

- [x] **Step 2: Append the CSS**

Append to `public/css/app.css`:

```css
/* Reports: plain CSS bar charts (no library). The bar width is set inline from the data. */
.report-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.report-table th, .report-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.report-table th { color: var(--ink); font-weight: 700; background: var(--primary-soft); }
.report-table .is-overdue { color: var(--bad); font-weight: 700; }
.bar-chart { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.bar-row { display: grid; grid-template-columns: 11rem 1fr 2.5rem; gap: 8px; align-items: center; }
.bar-label { font-size: 0.85rem; color: var(--ink); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { background: var(--primary-soft); border-radius: 4px; height: 1rem; overflow: hidden; }
.bar-fill { height: 100%; background: var(--primary); border-radius: 4px; }
.bar-count { font-size: 0.85rem; font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.filters .field { flex: 1 1 9rem; }
.report-summary { margin: 10px 0; }
```

- [x] **Step 3: Create `public/reports.html`**

```html
<!-- scope: shared -->
<!doctype html>
<html lang="ta" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SwabodhiniCare</title>
<script src="js/theme-boot.js"></script>
<script src="shared/dates.js"></script>
<script src="shared/actions.js"></script>
<script src="shared/permissions.js"></script>
<script src="shared/workflow.js"></script>
<script src="shared/form-schema.js"></script>
<script src="shared/reports.js"></script>
<link rel="stylesheet" href="css/app.css">
<script type="module" src="js/pages/reports.js"></script>
</head>
<body>
<div class="app">
  <header class="app-bar">
    <a class="wordmark" href="home.html">Swabodhini<b>Care</b></a>
    <button type="button" class="btn btn-outline btn-small" data-lang-toggle>தமிழ் / English</button>
  </header>
  <main class="screen">
    <a class="back-link" href="home.html" data-i18n="common.back">Back</a>
    <h1 data-i18n="reports.title">Reports</h1>
    <p class="alert alert-bad" id="message" role="alert" hidden></p>

    <div class="field">
      <label for="report" data-i18n="reports.title">Reports</label>
      <select class="input" id="report"></select>
    </div>

    <div class="filters" id="filters">
      <div class="field" id="centre-field"><label for="f-centre" data-i18n="reports.filterCentre">Centre</label><select class="input" id="f-centre"></select></div>
      <div class="field" id="status-field"><label for="f-status" data-i18n="reports.filterStatus">Status</label><select class="input" id="f-status"></select></div>
      <div class="field" id="program-field"><label for="f-program" data-i18n="reports.filterProgram">Program</label><select class="input" id="f-program"></select></div>
      <div class="field" id="age-field"><label for="f-age" data-i18n="reports.filterAge">Age band</label><select class="input" id="f-age"></select></div>
      <div class="field"><label for="f-from" data-i18n="reports.filterFrom">From</label><input class="input" id="f-from" type="date"></div>
      <div class="field"><label for="f-to" data-i18n="reports.filterTo">To</label><input class="input" id="f-to" type="date"></div>
      <div class="field"><button type="button" class="btn btn-outline btn-block" id="apply" data-i18n="reports.apply">Apply</button></div>
    </div>

    <div class="report-summary" id="summary" hidden></div>
    <p class="muted" id="empty" data-i18n="reports.noRows" hidden>No applications match these filters.</p>
    <div id="output"></div>
    <a class="btn btn-outline btn-block" id="download" href="#" hidden data-i18n="reports.download">Download Excel</a>
  </main>
  <nav class="bottom-nav" aria-label="Main">
    <a href="home.html" data-i18n="nav.home">Home</a>
    <a href="settings.html" data-i18n="nav.settings">Settings</a>
  </nav>
</div>
</body>
</html>
```

- [x] **Step 4: Create `public/js/pages/reports.js`**

```js
// scope: shared
// The reports screen (main spec §7 R3–R7): one page, a report picker, filters, and either a table
// or CSS bar charts. Download Excel hands the same rows to xlsx.js. All maths was done server-side
// (Reports.gs → shared/reports.js); this screen only renders and builds the file.
import { startPage, showMessage, setBusy } from "../page.js";
import { buildXlsx, downloadXlsx } from "../xlsx.js";

const { SC_FormSchema, SC_Reports, SC_Workflow, SC_Permissions } = window;
const $ = (id) => document.getElementById(id);

const CAN_PRINT = ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"];
const TABLE_REPORTS = ["register", "waitlist", "turnaround"];

const state = { page: null, me: null, report: "register", pageNo: 1, data: null, loaded: false };

const label = (list, value, lang) => {
  const found = list.find((o) => o.value === value);
  return found ? (lang === "en" ? found.en : found.ta) : value || "";
};

const shortDate = (iso) => String(iso || "").slice(0, 10);

// Which filter fields a report uses: the irrelevant ones are hidden so a date range never quietly
// filters a report that has no submission dates.
const FILTERS = {
  register: ["centre", "status", "program", "from", "to"],
  monthly: ["centre", "from", "to"],
  turnaround: ["centre", "status"],
  waitlist: ["centre", "program"],
  demographics: ["centre", "program", "age", "from", "to"],
};

function visibleFilters(report) {
  ["centre", "status", "program", "age", "from", "to"].forEach((key) => {
    const field = $(`${key === "from" ? "f-from" : key === "to" ? "f-to" : key === "age" ? "age-field" : `${key}-field`}`);
    field.hidden = !FILTERS[report].includes(key);
  });
}

function filters() {
  return {
    centre: $("f-centre").value || null,
    status: $("f-status").value || null,
    program: $("f-program").value || null,
    age: $("f-age").value || null,
    from: $("f-from").value || null,
    to: $("f-to").value || null,
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sheet(data, lang) {
  const t = (key) => state.page.t(key);
  const centre = (c) => label(SC_FormSchema.OPTIONS.CENTRE, c, lang);
  const program = (p) => label(SC_FormSchema.OPTIONS.PROGRAMS, p, lang);
  const gender = (g) => label(SC_FormSchema.OPTIONS.GENDER, g, lang);
  const status = (s) => t(`status.${s}`);

  if (state.report === "register") {
    return {
      headers: ["reports.col.appNo", "reports.col.regNo", "reports.col.name", "reports.col.age", "reports.col.gender", "reports.col.centre", "reports.col.status", "reports.col.therapist", "reports.col.submitted", "reports.col.suitability"].map(t),
      rows: data.items.map((r) => [r.appNo, r.registrationNo, r.name, r.age == null ? "" : String(r.age), gender(r.gender), centre(r.centre), status(r.status), r.therapist, shortDate(r.submitted), r.suitability || ""]),
    };
  }
  if (state.report === "waitlist") {
    return {
      headers: ["reports.col.appNo", "reports.col.name", "reports.col.centre", "reports.col.programs", "reports.col.waitlistedOn", "reports.col.therapist"].map(t),
      rows: data.items.map((r) => [r.appNo, r.name, centre(r.centre), r.programs.map(program).join(", "), shortDate(r.waitlistedOn), r.therapist]),
    };
  }
  if (state.report === "turnaround") {
    return {
      headers: ["reports.col.appNo", "reports.col.name", "reports.col.centre", "reports.col.status", "reports.col.days"].map(t),
      rows: data.pending.map((r) => [r.appNo, r.name, centre(r.centre), status(r.status), r.daysInStage == null ? "" : t("reports.days", { n: r.daysInStage })]),
    };
  }
  if (state.report === "monthly") {
    return {
      headers: ["reports.col.centre", "reports.col.month", "reports.col.submittedCount", "reports.col.admitted", "reports.col.waitlisted", "reports.col.rejected"].map(t),
      rows: data.items.map((r) => [centre(r.centre), r.month, String(r.submitted), String(r.admitted), String(r.waitlisted), String(r.rejected)]),
    };
  }
  // demographics → one sheet of dimension/category/count
  const dims = [["age", "Age"], ["gender", "Gender"], ["conditions", "Conditions"], ["udid", "UDID"], ["income", "Income"]];
  return {
    headers: [t("reports.title"), t("reports.col.name"), t("reports.col.count")],
    rows: dims.flatMap(([key, dim]) => data[key].map((row) => [dim, lang === "en" ? row.en : row.ta, String(row.count)])),
  };
}

function renderTable(rows) {
  const table = el("table", "report-table");
  const thead = el("thead");
  const headRow = el("tr");
  rows.headers.forEach((h) => headRow.append(el("th", "", h)));
  thead.append(headRow);
  const tbody = el("tbody");
  rows.rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((cell) => tr.append(el("td", "", cell)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  return table;
}

function renderBars(dimTitle, list) {
  const max = Math.max(1, ...list.map((r) => r.count));
  const box = el("div");
  box.append(el("h3", "muted", dimTitle));
  const chart = el("div", "bar-chart");
  list.forEach((row) => {
    const name = state.page.prefs().lang === "en" ? row.en : row.ta;
    const rowEl = el("div", "bar-row");
    rowEl.append(el("span", "bar-label", name));
    const track = el("div", "bar-track");
    track.append(Object.assign(el("div", "bar-fill"), { style: { width: `${(row.count / max) * 100}%` } }));
    rowEl.append(track);
    rowEl.append(el("span", "bar-count", String(row.count)));
    chart.append(rowEl);
  });
  box.append(chart);
  return box;
}

function draw() {
  const { data, loaded } = state;
  $("output").replaceChildren();
  $("summary").hidden = true;
  $("download").hidden = true;
  if (!loaded) return;
  if (!data) return;
  const rows = sheet(data, state.page.prefs().lang);

  if (TABLE_REPORTS.includes(state.report)) {
    $("output").append(renderTable(rows));
    $("empty").hidden = rows.rows.length > 0;
    if (state.report === "turnaround") {
      const summary = el("p", "report-summary");
      summary.append(el("strong", "", state.page.t("reports.avgDays") + ": "));
      summary.append(document.createTextNode(
        data.avgDaysPerStage.map((s) => `${state.page.t(`role.${s.stage}`)} ${s.avgDays == null ? "—" : s.avgDays}`).join(" · ")
      ));
      $("summary").append(summary);
      $("summary").hidden = false;
    }
  } else if (state.report === "monthly") {
    const chart = renderBars(state.page.t("reports.monthly"), data.items.map((r) => ({
      en: `${label(SC_FormSchema.OPTIONS.CENTRE, r.centre, "en")} · ${r.month}`,
      ta: `${label(SC_FormSchema.OPTIONS.CENTRE, r.centre, "ta")} · ${r.month}`,
      count: r.submitted,
    })));
    $("output").append(chart);
    $("empty").hidden = data.items.length > 0;
  } else if (state.report === "demographics") {
    const lang = state.page.prefs().lang;
    const dims = [["age", "reports.filterAge"], ["gender", "reports.col.gender"], ["conditions", "reports.col.programs"], ["udid", "reports.col.programs"], ["income", "reports.col.programs"]];
    dims.forEach(([key, titleKey]) => $("output").append(renderBars(state.page.t(titleKey), data[key])));
    $("empty").hidden = false; // charts render even when every count is zero
  }

  $("download").hidden = false;
}

async function load() {
  state.loaded = false;
  const result = await state.page.api.call("reports.get", {
    name: state.report, filters: filters(), page: state.pageNo,
  });
  if (!result.ok) {
    showMessage($("message"), state.page.errorMessage(result.error));
    return;
  }
  showMessage($("message"), "");
  state.data = result.data;
  state.loaded = true;
  draw();
}

function pickerOptions(list, allKey) {
  const t = (key) => state.page.t(key);
  const lang = state.page.prefs().lang;
  const all = el("option", "", t(allKey));
  all.value = "";
  return [all].concat(list.map((o) => {
    const opt = el("option", "", lang === "en" ? o.en : o.ta);
    opt.value = o.value;
    return opt;
  }));
}

function fillFilters() {
  const lang = state.page.prefs().lang;
  const isScoped = Boolean(state.me.centre);
  $("f-centre").replaceChildren(...pickerOptions(SC_FormSchema.OPTIONS.CENTRE, "reports.allCentres"));
  $("f-status").replaceChildren(...pickerOptions(
    Object.values(SC_Workflow.STATUS).map((value) => ({ value, en: state.page.t(`status.${value}`), ta: state.page.t(`status.${value}`) })),
    "reports.allStatuses"
  ));
  $("f-program").replaceChildren(...pickerOptions(SC_FormSchema.OPTIONS.PROGRAMS, "reports.allPrograms"));
  $("f-age").replaceChildren(...pickerOptions(SC_Reports.AGE_BANDS, "reports.allAges"));
  if (isScoped) {
    $("f-centre").value = state.me.centre;
    $("f-centre").disabled = true;
  }
}

function pickReport() {
  const t = (key) => state.page.t(key);
  $("report").replaceChildren(...[
    "register", "monthly", "turnaround", "waitlist", "demographics",
  ].map((id) => {
    const opt = el("option", "", t(`reports.${id}`));
    opt.value = id;
    return opt;
  }));
  $("report").value = state.report;
  visibleFilters(state.report);
  $("report").addEventListener("change", () => {
    state.report = $("report").value;
    state.pageNo = 1;
    visibleFilters(state.report);
    load();
  });
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const me = await page.api.call("me.get");
  if (!me.ok) { showMessage($("message"), page.errorMessage(me.error)); return; }
  if (me.data.mustChangePassword) { window.location.assign("password.html"); return; }
  page.setPrefs({ lang: me.data.preferredLang, theme: me.data.preferredTheme });
  state.page = page;
  state.me = me.data;
  pickReport();
  fillFilters();
  page.onRender(() => { fillFilters(); draw(); });
  $("apply").addEventListener("click", () => { state.pageNo = 1; load(); });
  $("download").addEventListener("click", () => {
    const filename = `report-${state.report}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    downloadXlsx(filename, [sheet(state.data, page.prefs().lang)]);
  });
  await load();
}

main().catch((err) => console.error("The reports screen could not start", err));
```

- [x] **Step 5: Add the gated Reports link to the home screen**

In `public/home.html`, add one link to the bottom nav:

```html
  <nav class="bottom-nav" aria-label="Main">
    <a href="home.html" aria-current="page" data-i18n="nav.home">Home</a>
    <a href="reports.html" id="nav-reports" data-i18n="nav.reports" hidden>Reports</a>
    <a href="settings.html" data-i18n="nav.settings">Settings</a>
  </nav>
```

In `public/js/pages/home.js`, after the line that sets `$("new-application").hidden`, add:

```js
  $("nav-reports").hidden = !SC_Permissions.can(user.roles, "reports.view");
```

- [x] **Step 6: Run the scope check and the tests**

Run: `npm test`
Expected: all pass. (`check-scope.mjs` confirms `reports.html`/`reports.js` carry the right scope headers and use no banned APIs.)

- [x] **Step 7: Verify in a browser**

Run `node poc/scripts/dev-server.mjs`, open `http://127.0.0.1:8787`, sign in as `revathi@example.com` / `demo-pass-2026`, open Reports, switch between reports, apply a filter, and download an `.xlsx` — confirm the file opens in a spreadsheet reader.

- [x] **Step 8: Commit**

```bash
git add public/reports.html public/js/pages/reports.js public/css/app.css public/i18n/en.json public/i18n/ta.json public/home.html public/js/pages/home.js
git commit -m "feat: reports screen with filters, CSS bar charts and Excel download"
```

---

### Task 6: The A4 print report (`print.html` + `print.js` + `print.css`)

**Files:**
- Create: `public/print.html`, `public/js/pages/print.js`, `public/css/print.css`
- Modify: `public/i18n/en.json`, `public/i18n/ta.json`

**Interfaces:**
- Consumes: `startPage`/`showMessage` from `../page.js`; `createFormView` from `../form-view.js` (its `stepModel(stepId, values, today, lang)` returns `{ title, fields: [{ id, type, label, value, options }] }`); `window.SC_FormSchema`, `window.SC_Dates`; the `reports.get { name: "print", id }` envelope from Task 3 (`{ app, signature, signerName, signedAt }`).
- Produces: the A4 Individual Assessment Report.

- [x] **Step 1: Add the print i18n keys**

Append to `public/i18n/en.json`:

```json
  "print.title": "Individual Assessment Report",
  "print.print": "Print",
  "print.reviewTrail": "Review trail",
  "print.signature": "Director's signature",
  "print.notSigned": "Not yet decided",
  "print.noSignature": "No signature stored",
  "print.signedBy": "Signed by {name} · {date}",
  "print.consentSigned": "Consent signed",
  "print.consentNotSigned": "Consent not signed"
```

Append to `public/i18n/ta.json`:

```json
  "print.title": "தனிநபர் மதிப்பீட்டு அறிக்கை",
  "print.print": "அச்சிடு",
  "print.reviewTrail": "மதிப்பாய்வுப் பாதை",
  "print.signature": "இயக்குநரின் கையொப்பம்",
  "print.notSigned": "இன்னும் முடிவு செய்யப்படவில்லை",
  "print.noSignature": "கையொப்பம் சேமிக்கப்படவில்லை",
  "print.signedBy": "{name} · {date} கையொப்பம்",
  "print.consentSigned": "ஒப்புதல் கையொப்பமிடப்பட்டது",
  "print.consentNotSigned": "ஒப்புதல் கையொப்பமிடப்படவில்லை"
```

- [x] **Step 2: Create `public/css/print.css`**

```css
/* scope: shared */
/* The A4 report is always light — dark text on white — whatever the screen's theme (spec D2). */
.print-report { background: #ffffff; color: #111111; max-width: 700px; margin: 0 auto; padding: 24px; font-family: var(--f-body); }
.print-report h1 { font-size: 1.5rem; margin: 0 0 16px; }
.print-report h2 { font-size: 1.1rem; margin: 20px 0 8px; border-bottom: 1px solid #999; }
.print-report .print-head { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-bottom: 8px; font-size: 0.9rem; }
.print-report .print-head .mono { font-family: var(--f-mono); }
.print-report dl { margin: 0; }
.print-report .fact { display: grid; grid-template-columns: 11rem 1fr; gap: 4px 12px; padding: 4px 0; border-bottom: 1px solid #eee; }
.print-report .fact dt { font-weight: 700; }
.print-report .review-row { padding: 6px 0; border-bottom: 1px solid #eee; font-size: 0.9rem; }
.print-report .review-row .who { font-weight: 700; }
.print-report .review-row .when { color: #666; font-size: 0.8rem; }
.print-report .signature img { max-height: 90px; }
@media print {
  body { background: #ffffff; }
  .app-bar, .bottom-nav, .back-link, .no-print { display: none !important; }
  .screen { padding: 0; }
  .print-report { max-width: none; padding: 0; }
  .print-report h2, .print-report .fact, .print-report .review-row { break-inside: avoid; }
}
```

- [x] **Step 3: Create `public/print.html`**

```html
<!-- scope: shared -->
<!doctype html>
<html lang="ta" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SwabodhiniCare</title>
<script src="js/theme-boot.js"></script>
<script src="shared/dates.js"></script>
<script src="shared/actions.js"></script>
<script src="shared/permissions.js"></script>
<script src="shared/workflow.js"></script>
<script src="shared/form-schema.js"></script>
<script src="shared/form-rules.js"></script>
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/print.css">
<script type="module" src="js/pages/print.js"></script>
</head>
<body>
<div class="app">
  <header class="app-bar">
    <a class="wordmark" href="home.html">Swabodhini<b>Care</b></a>
    <button type="button" class="btn btn-outline btn-small no-print" data-lang-toggle>தமிழ் / English</button>
  </header>
  <main class="screen">
    <a class="back-link no-print" id="back" href="home.html" data-i18n="common.back">Back</a>
    <button type="button" class="btn btn-primary no-print" id="print-button" data-i18n="print.print">Print</button>
    <p class="muted" id="loading" data-i18n="common.loading">Loading…</p>
    <p class="alert alert-bad no-print" id="message" role="alert" hidden></p>
    <article class="print-report" id="report" hidden></article>
  </main>
  <nav class="bottom-nav no-print" aria-label="Main">
    <a href="home.html" data-i18n="nav.home">Home</a>
    <a href="settings.html" data-i18n="nav.settings">Settings</a>
  </nav>
</div>
</body>
</html>
```

- [x] **Step 4: Create `public/js/pages/print.js`**

```js
// scope: shared
// The A4 Individual Assessment Report (main spec §7 R2): one application, all 11 form sections in
// the chosen language, the review trail in order, and the Director's signature. Always light, and
// printed via the browser's Print → Save as PDF (no PDF library).
import { startPage, showMessage } from "../page.js";
import { createFormView } from "../form-view.js";

const { SC_FormSchema, SC_FormRules, SC_Dates } = window;
const $ = (id) => document.getElementById(id);

const ACTION_LABEL = {
  APPROVE: "action.approve", SEND_BACK: "action.sendBack", REJECT: "action.reject",
  ADMIT: "action.admit", WAITLIST: "action.waitlist", REOPEN: "action.reopen",
};

const state = { page: null, data: null };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(state.page.prefs().lang === "en" ? "en-IN" : "ta-IN", { day: "numeric", month: "short", year: "numeric" });
}

function optionLabel(list, value) {
  const found = SC_FormSchema.OPTIONS[list].find((o) => o.value === value);
  return found ? (state.page.prefs().lang === "en" ? found.en : found.ta) : value || "";
}

function fieldAnswer(field) {
  const t = state.page.t;
  if (field.type === "consent") return field.value ? t("print.consentSigned") : t("print.consentNotSigned");
  if (field.type === "file") return Array.isArray(field.value) ? String(field.value.length) : "0";
  if (Array.isArray(field.value)) return field.value.map((v) => optionLabel(field.options, v)).filter(Boolean).join(", ");
  if (field.value === null || field.value === undefined || field.value === "") return "";
  if (field.options) return optionLabel(field.options, field.value);
  return String(field.value);
}

function sections(app) {
  const view = createFormView({ schema: SC_FormSchema, rules: SC_FormRules, dates: SC_Dates });
  const lang = state.page.prefs().lang;
  return view.stepIds.map((stepId) => {
    const step = view.stepModel(stepId, app.values || {}, SC_Dates.todayIso ? SC_Dates.todayIso() : new Date().toISOString().slice(0, 10), lang);
    const section = el("section");
    section.append(el("h2", "", `${step.number}. ${step.title}`));
    const dl = el("dl");
    step.fields.forEach((field) => {
      const answer = fieldAnswer(field);
      if (answer === "" && field.type !== "consent") return; // leave truly empty answers out
      const row = el("div", "fact");
      row.append(el("dt", "", field.label));
      row.append(el("dd", "", answer));
      dl.append(row);
    });
    section.append(dl);
    return section;
  });
}

function reviewTrail(app) {
  const t = state.page.t;
  const box = el("section");
  box.append(el("h2", "", t("print.reviewTrail")));
  (app.approvals || []).forEach((r) => {
    const row = el("div", "review-row");
    row.append(el("div", "who", `${t(`role.${r.stage}`)} · ${r.userName}`));
    row.append(el("div", "", `${t(ACTION_LABEL[r.action] || `action.${r.action.toLowerCase()}`)}${r.comment ? ` — ${r.comment}` : ""}`));
    row.append(el("div", "when", fmt(r.at)));
    box.append(row);
  });
  return box;
}

function signatureBlock() {
  const t = state.page.t;
  const { signature, signerName, signedAt } = state.data;
  const box = el("section");
  box.append(el("h2", "", t("print.signature")));
  if (!signerName) {
    box.append(el("p", "", t("print.notSigned")));
    return box;
  }
  if (signature) {
    const img = el("img");
    img.src = `data:image/png;base64,${signature}`;
    img.alt = signerName;
    box.append(el("div", "signature", ""));
    box.lastChild.append(img);
  } else {
    box.append(el("p", "", t("print.noSignature")));
  }
  box.append(el("p", "", t("print.signedBy", { name: signerName, date: fmt(signedAt) })));
  return box;
}

function draw() {
  const t = state.page.t;
  const app = state.data.app;
  const report = $("report");
  report.replaceChildren();
  const lang = state.page.prefs().lang;

  report.append(el("h1", "", t("print.title")));
  const head = el("div", "print-head");
  head.append(el("span", "", `${t("reports.col.appNo")}: `), el("span", "mono", app.appNo || ""));
  head.append(el("span", "", `${t("reports.col.regNo")}: `), el("span", "mono", app.registrationNo || "—"));
  head.append(el("span", "", `${t("reports.col.centre")}: `), el("span", "", optionLabel("CENTRE", app.centre)));
  head.append(el("span", "", `${t("print.date")}: `), el("span", "", new Date().toISOString().slice(0, 10)));
  report.append(head);

  report.append(el("h2", "", `${t("reports.col.name")}: ${app.applicantName || t("form.untitled")}`));

  sections(app).forEach((section) => report.append(section));
  report.append(reviewTrail(app));
  report.append(signatureBlock());

  $("report").hidden = false;
  $("loading").hidden = true;
  $("back").href = document.referrer || "home.html";
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  state.page = page;
  const id = new URL(window.location.href).searchParams.get("id");
  const result = id ? await page.api.call("reports.get", { name: "print", id }) : { ok: false, error: { code: "NOT_FOUND" } };
  if (!result.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(result.error));
    return;
  }
  state.data = result.data;
  page.onRender(draw);
  $("print-button").addEventListener("click", () => window.print());
}

main().catch((err) => console.error("The print screen could not start", err));
```

- [x] **Step 5: Add the `print.date` key**

The print header uses `print.date`, which was not in Task 6 Step 1. Add to both files:

`en.json`: `"print.date": "Date",` · `ta.json`: `"print.date": "தேதி",`

- [x] **Step 6: Run the scope check and the suite**

Run: `npm test`
Expected: all pass.

- [x] **Step 7: Verify in a browser**

Run `node poc/scripts/dev-server.mjs`, sign in as `revathi@example.com` / `demo-pass-2026`, open an admitted application's `print.html?id=…`, confirm all 11 sections, the review trail, the Director's signature and name appear, and Print → Save as PDF produces a light A4 page.

- [x] **Step 8: Commit**

```bash
git add public/print.html public/js/pages/print.js public/css/print.css public/i18n/en.json public/i18n/ta.json
git commit -m "feat: A4 individual assessment report (print)"
```

---

### Task 7: Print links and the TODO update

**Files:**
- Modify: `public/review.html`, `public/js/pages/review.js`, `public/decision.html`, `public/js/pages/decision.js`, `public/js/pages/reports.js` (register-row print link), `TODO.md`

**Interfaces:**
- Consumes: the `print.html?id=` route from Task 6; `common.printReport` (already in i18n); `state.app.id` (review/decision), `state.decided.id` (decision's signed screen), register rows' `r.id` (reports.js).

- [ ] **Step 1: Review screen — add the print link**

In `public/review.html`, next to the existing "Read full application" link inside the Key facts panel, add:

```html
        <a class="btn btn-outline btn-block" id="print" href="print.html" data-i18n="common.printReport">Print the report</a>
```

In `public/js/pages/review.js`, in `draw()` (after the `$("read-full").href = …` line), add:

```js
  const canPrint = ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"].some((role) => me.roles.includes(role));
  $("print").hidden = !canPrint;
  $("print").href = `print.html?id=${encodeURIComponent(app.id)}`;
```

- [ ] **Step 2: Decision screen — add the print link to the signed screen**

In `public/decision.html`, in the `#done-body` (after the "Back to queue" link), add:

```html
      <a class="btn btn-primary btn-block" id="print" href="print.html" data-i18n="common.printReport">Print the report</a>
```

In `public/js/pages/decision.js`, in `drawDone()` (after `$("done-lock").hidden = !locked;`), add:

```js
  $("print").href = `print.html?id=${encodeURIComponent(state.decided.id)}`;
```

- [ ] **Step 3: Register rows — add a print link per row**

In `public/js/pages/reports.js`, the register table's rows should link to the print report. Update the `sheet()` register case so the app number is a link is not needed — instead, add a helper and a "Print" affordance. Replace the register case in `sheet()` with a version that also returns the row ids for linking, and in `renderTable` render the app-number cell as a link:

Add to `reports.js` (after `shortDate`):

```js
function registerRows() {
  const data = state.data;
  return data.items.map((r) => ({
    id: r.id,
    cells: [r.appNo, r.registrationNo, r.name, r.age == null ? "" : String(r.age), r.gender, r.centre, r.status, r.therapist, shortDate(r.submitted), r.suitability || ""],
  }));
}
```

And in `draw()`, when `state.report === "register"` and the viewer may print, render the table with the app-number cell as a link to `print.html?id=…`. Keep the change minimal: in `renderTable`, add a per-row link when `state.report === "register"` and `CAN_PRINT.some((r) => state.me.roles.includes(r))`:

```js
function renderTable(rows) {
  const table = el("table", "report-table");
  const thead = el("thead");
  const headRow = el("tr");
  rows.headers.forEach((h) => headRow.append(el("th", "", h)));
  thead.append(headRow);
  const tbody = el("tbody");
  const linkFirst = state.report === "register" && CAN_PRINT.some((r) => state.me.roles.includes(r));
  rows.rows.forEach((cells, i) => {
    const tr = el("tr");
    cells.forEach((cell, c) => {
      if (linkFirst && c === 0 && rows.ids && rows.ids[i]) {
        const a = el("a", "", cell);
        a.href = `print.html?id=${encodeURIComponent(rows.ids[i])}`;
        tr.append(el("td", "").appendChild(a) && tr.lastChild);
      } else {
        tr.append(el("td", "", cell));
      }
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  return table;
}
```

And in `sheet()` for register, include the ids: add `ids: data.items.map((r) => r.id)` to the returned register object. (The `renderTable` above reads `rows.ids`.)

- [ ] **Step 4: Update `TODO.md`**

Mark the plan done and reflect the new state:
- In the **Start here** table, change the M8 plan row from "**next** —" to "✅ done —", and update the status sentence to "**M8 (reports, Excel, print) is in progress** — spec and plan committed; implementation is the next step."
- In the **M8** section header, change `⏳ in progress (plan next)` to `⏳ in progress`.
- Tick the M8 line items as they are completed by these tasks (after a final full run): `shared/reports.js`, Reports screens, `xlsx.js`, A4 print, R5 carry-forward, and `Reports.gs`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add public/review.html public/js/pages/review.js public/decision.html public/js/pages/decision.js public/js/pages/reports.js TODO.md
git commit -m "feat: link the print report from register, review and decision"
```

---

## Self-review notes

- **Spec coverage:** R3 (register), R4 (monthly), R5 (turnaround + rejection-date carry-forward), R6 (waitlist), R7 (demographics) are Task 1/2 (maths), Task 3 (server), Task 5 (screen). R2 print is Task 6, reachable from register (Task 7.3), review (Task 7.1) and decision (Task 7.2). The Excel builder (Task 4) is reused by Task 5 and, later, M9. The access matrix (D3) and centre-scoping (spec "Centre-scoping") are enforced in Task 3 and tested. D1 (server-side maths) and D2 (one reports screen) hold throughout.
- **Type consistency:** `SC_Reports.registerRows/monthlyByCentre/waitlist/demographics/turnaround/rejectionDate/ageBandFor` and `SC_ReportsApi.get` names match across tasks; the print payload keys `{ app, signature, signerName, signedAt }` match Task 6's `signatureBlock()/draw()`. `SC_FormSchema.OPTIONS` list names (`CENTRE`, `PROGRAMS`, `GENDER`, `CONDITIONS`, `UDID`, `INCOME`) and `SC_Reports.AGE_BANDS` match the schema.
- **Known simplifications, stated:** a send-back leg in `stageSpans` measures from the previous completed stage (exact per-round timing is out of scope); Tamil report wording is a first pass pending staff review (already tracked in TODO "Decisions still open").
