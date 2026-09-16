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
  assert.equal(rows[1].registrationNo, "");
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
    app({ id: "a1", status: "PENDING_CENTRE_HEAD", submitted_at: "2026-09-01", decided_at: null }),
    app({ id: "a2", status: "PENDING_THERAPY_HEAD", submitted_at: "2026-09-15", decided_at: null }),
    app({ id: "a3", status: "ADMITTED" }), // not in flight
    app({ id: "a9", status: "PENDING_DIRECTOR", submitted_at: "2026-08-01", decided_at: null }),
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
