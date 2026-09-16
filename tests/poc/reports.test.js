const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

// The signature-pad's PNG sniff only checks the magic bytes, so the 8-byte header is a valid
// signature for the fake Drive (the same bytes signatures.test.js checks against).
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
