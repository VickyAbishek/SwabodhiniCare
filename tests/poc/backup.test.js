// scope: poc
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

function seedApp(ctx, overrides) {
  return ctx.SC_Store.insert("Applications", Object.assign({
    id: ctx.SC_Store.newId(), app_no: "APP-2026-0001", registration_no: null, centre: "VLC",
    status: "DRAFT", applicant_name: "Arjun Karthik", dob: "2020-03-14", gender: "MALE",
    suitability: null, programs: [], created_by: "u-priya",
    submitted_at: null, decided_at: null,
    version: 1, created_at: "2026-09-01T09:00:00.000Z", updated_at: "2026-09-01T09:00:00.000Z",
  }, overrides));
}

test("an Admin can run a backup and get a COMPLETE BackupLog row", () => {
  const { ctx, as } = setupPeople();
  seedApp(ctx);
  seedApp(ctx, { app_no: "APP-2026-0002" });

  const res = as("anand")("admin.backups.runNow", {});
  assert.equal(res.ok, true);
  const row = res.data;

  assert.equal(row.period, "2026-09"); // the school's month, from the test clock
  assert.equal(row.status, "COMPLETE");
  assert.ok(row.sheet_copy_id, "a sheet-copy file id is stored");
  assert.ok(row.xlsx_file_id, "an xlsx file id is stored");
  assert.ok(row.started_at && row.finished_at);

  // rows counts every table except Sessions.
  assert.equal(row.rows.Applications, 2);
  assert.equal(row.rows.Users, 6);
  assert.equal("Sessions" in row.rows, false);
  assert.equal(Object.keys(row.rows).length, 9); // the ten BASE tabs minus Sessions
});

test("the result email is sent to the active Admin", () => {
  const { ctx, as } = setupPeople();
  as("anand")("admin.backups.runNow", {});

  assert.equal(ctx.MailApp.sent.length, 1);
  assert.equal(ctx.MailApp.sent[0].to, "anand@example.com");
  assert.match(ctx.MailApp.sent[0].subject, /2026-09/);
});

test("backups.run is Admin-only; backups.view is Director-or-Admin", () => {
  const { as } = setupPeople();
  assert.equal(as("revathi")("admin.backups.runNow", {}).error.code, "NOT_ALLOWED"); // Director: view, not run
  assert.equal(as("priya")("admin.backups.list", {}).error.code, "NOT_ALLOWED");    // Therapist: neither
  assert.equal(as("revathi")("admin.backups.list", {}).ok, true);                   // Director: view
  assert.equal(as("anand")("admin.backups.list", {}).ok, true);                     // Admin: view
});

test("retention trashes files older than 24 months and keeps newer ones", () => {
  const { ctx } = setupPeople();
  const now = "2026-09-15T10:00:00.000Z";

  // A backup made 25 months ago: a Drive file and its BackupLog row.
  const folder = ctx.DriveApp.getRootFolder().createFolder("Backups");
  const oldFile = folder.createFile(ctx.Utilities.newBlob([], "application/vnd.google-apps.spreadsheet", "old"));
  ctx.SC_Store.insert("BackupLog", {
    period: "2024-08", status: "COMPLETE", sheet_copy_id: oldFile.getId(), xlsx_file_id: "",
  });

  // A fresh backup prunes the old file but not its own.
  const fresh = ctx.SC_Backup.runBackup("2026-09", now);
  assert.equal(ctx.DriveApp.getFileById(oldFile.getId()).isTrashed(), true);
  assert.equal(ctx.DriveApp.getFileById(fresh.sheet_copy_id).isTrashed(), false);
});
