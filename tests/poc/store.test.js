const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContext, plain } = require("./harness.js");

const TABS = ["Users", "Sessions", "Centres", "Applications", "Approvals", "Attachments", "Signatures", "Audit", "Config", "BackupLog"];

function setup(options) {
  const ctx = createContext(options);
  ctx.SC_Store.ensureTabs();
  return ctx;
}

function rawTab(ctx, tab) {
  return plain(ctx.SpreadsheetApp.openById("test-sheet").getSheetByName(tab).getDataRange().getValues());
}

test("ensureTabs creates every tab with a header row, once", () => {
  const ctx = createContext();
  assert.deepEqual(plain(ctx.SC_Store.ensureTabs()), TABS);
  const book = ctx.SpreadsheetApp.openById("test-sheet");
  assert.deepEqual(book.getSheets().map((s) => s.getName()), TABS);
  assert.equal(rawTab(ctx, "Users")[0][0], "id");
  assert.deepEqual(plain(ctx.SC_Store.ensureTabs()), []);
});

test("the Applications tab has one column per form question", () => {
  const ctx = setup();
  const header = rawTab(ctx, "Applications")[0];
  assert.ok(header.includes("app_no") && header.includes("version"));
  for (const field of ctx.SC_FormSchema.allFields()) assert.ok(header.includes(field.id), field.id);
});

test("ensureTabs adds columns that are missing from an existing tab", () => {
  const ctx = createContext();
  const sheet = ctx.SpreadsheetApp.openById("test-sheet").insertSheet("Config");
  sheet.appendRow(["key"]);
  ctx.SC_Store.ensureTabs();
  assert.deepEqual(rawTab(ctx, "Config")[0], ["key", "value"]);
});

test("text columns are plain-text formatted; number columns are not", () => {
  const ctx = setup();
  const sheet = ctx.SpreadsheetApp.openById("test-sheet").getSheetByName("Users");
  const header = rawTab(ctx, "Users")[0];
  assert.equal(sheet.formats[header.indexOf("phone") + 1], "@");
  assert.equal(sheet.formats[header.indexOf("created_at") + 1], "@");
  assert.equal(sheet.formats[header.indexOf("failed_logins") + 1], undefined);
});

test("insert and find keep types and stay readable in the Sheet", () => {
  const ctx = setup();
  ctx.SC_Store.insert("Users", {
    id: "u1", email: "a@example.com", name: "Anand K", roles: ["ADMIN", "THERAPIST"],
    is_active: true, failed_logins: 0, kdf_iterations: 600000,
  });
  const header = rawTab(ctx, "Users")[0];
  const row = rawTab(ctx, "Users")[1];
  assert.equal(row[header.indexOf("roles")], "ADMIN, THERAPIST");
  assert.equal(row[header.indexOf("is_active")], "TRUE");
  const found = plain(ctx.SC_Store.find("Users", "email", "a@example.com"));
  assert.deepEqual(found.roles, ["ADMIN", "THERAPIST"]);
  assert.equal(found.is_active, true);
  assert.equal(found.failed_logins, 0);
  assert.equal(found.kdf_iterations, 600000);
  assert.equal(found.phone, null);
  assert.equal(ctx.SC_Store.find("Users", "email", "nobody@example.com"), null);
});

test("form answers round-trip with their schema types", () => {
  const ctx = setup();
  ctx.SC_Store.insert("Applications", {
    id: "a1", app_no: "APP-2026-0001", version: 1, s1_programs: ["YOGA", "SPORTS"],
    s3_siblings: 2, s11_consent: true, s2_full_name: "Arjun", s2_dob: "2020-03-14",
  });
  const app = plain(ctx.SC_Store.find("Applications", "id", "a1"));
  assert.deepEqual(app.s1_programs, ["YOGA", "SPORTS"]);
  assert.equal(app.s3_siblings, 2);
  assert.equal(app.s11_consent, true);
  assert.equal(app.s2_dob, "2020-03-14");
  assert.deepEqual(app.s2_photo, []);
});

test("insert refuses columns the tab does not have", () => {
  const ctx = setup();
  assert.throws(() => ctx.SC_Store.insert("Users", { id: "u1", favourite_colour: "blue" }), /Unknown column/);
});

test("update merges a patch, keeps other values and returns null for a missing row", () => {
  const ctx = setup();
  ctx.SC_Store.insert("Users", { id: "u1", email: "a@example.com", name: "Anand K", failed_logins: 0 });
  const updated = plain(ctx.SC_Store.update("Users", "u1", { failed_logins: 3 }));
  assert.equal(updated.failed_logins, 3);
  assert.equal(updated.name, "Anand K");
  assert.equal(ctx.SC_Store.find("Users", "id", "u1").failed_logins, 3);
  assert.equal(ctx.SC_Store.update("Users", "missing", { name: "x" }), null);
});

test("all and filter return decoded rows", () => {
  const ctx = setup();
  ctx.SC_Store.insert("Centres", { id: "c1", code: "TVM", is_active: true });
  ctx.SC_Store.insert("Centres", { id: "c2", code: "VLC", is_active: false });
  assert.equal(ctx.SC_Store.all("Centres").length, 2);
  assert.deepEqual(plain(ctx.SC_Store.filter("Centres", (c) => c.is_active).map((c) => c.code)), ["TVM"]);
});

test("nextSeq counts up without gaps, only inside the lock", () => {
  const ctx = setup();
  assert.throws(() => ctx.SC_Store.nextSeq("app_seq:2026"), /inside withLock/);
  const values = ctx.SC_Store.withLock(() => [
    ctx.SC_Store.nextSeq("app_seq:2026"),
    ctx.SC_Store.nextSeq("app_seq:2026"),
    ctx.SC_Store.nextSeq("reg_seq:VLC:2026"),
  ]);
  assert.deepEqual(plain(values), [1, 2, 1]);
  assert.equal(ctx.SC_Store.find("Config", "key", "app_seq:2026").value, "2");
});

test("withLock answers BUSY when another request holds the lock", () => {
  const ctx = setup();
  ctx.LockService.state.held = true;
  const result = plain(ctx.SC_Store.withLock(() => "never"));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BUSY");
});

test("withLock releases the lock even when the work fails", () => {
  const ctx = setup();
  assert.throws(() => ctx.SC_Store.withLock(() => { throw new Error("boom"); }), /boom/);
  assert.equal(ctx.LockService.state.held, false);
});

test("a missing SHEET_ID is reported clearly", () => {
  const ctx = createContext({ properties: { SHEET_ID: "" } });
  assert.throws(() => ctx.SC_Store.ensureTabs(), /SHEET_ID/);
});

test("nowIso and newId", () => {
  const ctx = setup();
  assert.equal(ctx.SC_Store.nowIso(), "2026-09-15T10:00:00.000Z");
  assert.match(ctx.SC_Store.newId(), /^[0-9a-f]{32}$/);
});
