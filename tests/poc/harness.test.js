const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createContext, plain } = require("./harness.js");

test("the harness exposes the shared scripts as globals", () => {
  const ctx = createContext();
  assert.equal(ctx.SC_Numbers.formatAppNo(2026, 1), "APP-2026-0001");
  assert.ok(ctx.SC_Workflow && ctx.SC_Actions && ctx.SC_FormSchema && ctx.SC_FormRules);
  assert.equal(ctx.SC_FormRules.validate({}, { mode: "draft", today: "2026-09-15" }).ok, true);
});

test("computeDigest returns signed bytes like Apps Script", () => {
  const ctx = createContext();
  const bytes = ctx.Utilities.computeDigest(ctx.Utilities.DigestAlgorithm.SHA_256, "abc");
  assert.equal(bytes.length, 32);
  assert.ok(bytes.every((b) => b >= -128 && b <= 127));
  assert.ok(bytes.some((b) => b < 0));
});

test("HMAC, UUID and base64 fakes", () => {
  const ctx = createContext();
  assert.equal(ctx.Utilities.computeHmacSha256Signature("msg", "key").length, 32);
  assert.match(ctx.Utilities.getUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(ctx.Utilities.base64Encode("hi"), "aGk=");
});

test("a fake spreadsheet keeps tabs and values", () => {
  const ctx = createContext();
  const ss = ctx.SpreadsheetApp.openById("test-sheet");
  const sheet = ss.insertSheet("Users");
  sheet.appendRow(["id", "email"]);
  sheet.appendRow(["u1", "a@example.com"]);
  assert.deepEqual(plain(sheet.getDataRange().getValues()), [["id", "email"], ["u1", "a@example.com"]]);
  sheet.getRange(2, 2).setValue("b@example.com");
  assert.equal(ss.getSheetByName("Users").getRange(2, 2, 1, 1).getValues()[0][0], "b@example.com");
  sheet.getRange(1, 3, 1, 1).setValues([["role"]]);
  assert.equal(sheet.getLastColumn(), 3);
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(ss.getSheetByName("Nope"), null);
});

test("the fake script lock can be held and times out", () => {
  const ctx = createContext();
  const lock = ctx.LockService.getScriptLock();
  assert.equal(lock.tryLock(10), true);
  assert.equal(ctx.LockService.getScriptLock().tryLock(10), false);
  lock.releaseLock();
  assert.equal(ctx.LockService.getScriptLock().tryLock(10), true);
});

test("cache values expire on the test clock", () => {
  const clock = { ms: Date.parse("2026-09-15T10:00:00Z") };
  const ctx = createContext({ clock });
  const cache = ctx.CacheService.getScriptCache();
  cache.put("k", "v", 60);
  assert.equal(cache.get("k"), "v");
  clock.ms += 61000;
  assert.equal(cache.get("k"), null);
});

test("new Date() inside the context follows the test clock", () => {
  const clock = { ms: Date.parse("2026-09-15T10:00:00Z") };
  const ctx = createContext({ clock });
  assert.equal(ctx.run("new Date().toISOString()"), "2026-09-15T10:00:00.000Z");
  assert.equal(ctx.run('new Date("2020-01-01T00:00:00Z").getUTCFullYear()'), 2020);
});

test("script properties and JSON text output", () => {
  const ctx = createContext({ properties: { SHEET_ID: "test-sheet" } });
  const props = ctx.PropertiesService.getScriptProperties();
  assert.equal(props.getProperty("SHEET_ID"), "test-sheet");
  props.setProperty("HMAC_SECRET", "s");
  assert.equal(props.getProperty("HMAC_SECRET"), "s");
  const out = ctx.ContentService.createTextOutput("{}").setMimeType(ctx.ContentService.MimeType.JSON);
  assert.equal(out.getContent(), "{}");
  assert.equal(out.getMimeType(), "application/json");
});

test("console.error calls are captured", () => {
  const ctx = createContext();
  ctx.run('console.error("boom", 1)');
  assert.deepEqual(ctx.logs.errors, [["boom", 1]]);
});
