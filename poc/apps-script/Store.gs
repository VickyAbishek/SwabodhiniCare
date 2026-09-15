// scope: poc
/* Sheet-backed tables for the POC (POC spec §6, §8). One tab per table; row 1 holds the headers.
   Values stay readable in the Sheet: lists as "A, B", yes/no as TRUE/FALSE. Text columns are set to
   plain-text format so Sheets never turns phone numbers or dates into numbers. */
var SC_Store = (function () {
  "use strict";

  var LOCK_WAIT_MS = 10000;
  var BASE = {
    Users: ["id", "email", "name", "phone", "roles:list", "centre", "password_hash", "password_salt",
      "kdf_iterations:number", "must_change_password:bool", "preferred_lang", "preferred_theme",
      "is_active:bool", "failed_logins:number", "locked_until", "created_at", "updated_at"],
    Sessions: ["token_hash", "user_id", "created_at", "last_seen_at", "expires_at"],
    Centres: ["id", "code", "name_en", "name_ta", "address", "is_active:bool"],
    Applications: ["id", "app_no", "registration_no", "centre", "status", "applicant_name", "dob", "gender",
      "suitability", "programs:list", "created_by", "submitted_at", "decided_at", "version:number",
      "created_at", "updated_at"],
    Approvals: ["id", "application_id", "stage", "action", "comment", "user_id", "form_hash", "created_at"],
    Attachments: ["id", "application_id", "kind", "drive_file_id", "filename", "mime", "size:number",
      "uploaded_by", "created_at", "deleted_at"],
    Signatures: ["user_id", "drive_file_id", "uploaded_at"],
    Audit: ["id", "user_id", "action", "entity", "entity_id", "details:json", "created_at"],
    Config: ["key", "value"],
    BackupLog: ["period", "status", "sheet_copy_id", "xlsx_file_id", "rows:json", "error", "started_at", "finished_at"],
  };
  var FORM_TYPES = { number: "number", multi: "list", file: "list", consent: "bool" };

  var tablesCache = null;
  var lockDepth = 0;

  function parseColumn(spec) {
    var parts = spec.split(":");
    return Object.freeze({ name: parts[0], type: parts[1] || "text" });
  }

  // Built on first use, so the order in which Apps Script loads files doesn't matter.
  function tables() {
    if (tablesCache) return tablesCache;
    var built = {};
    Object.keys(BASE).forEach(function (tab) {
      built[tab] = BASE[tab].map(parseColumn);
    });
    SC_FormSchema.allFields().forEach(function (field) {
      built.Applications.push(Object.freeze({ name: field.id, type: FORM_TYPES[field.type] || "text" }));
    });
    Object.keys(built).forEach(function (tab) { Object.freeze(built[tab]); });
    tablesCache = Object.freeze(built);
    return tablesCache;
  }

  function columnType(tab, name) {
    var column = tables()[tab].find(function (c) { return c.name === name; });
    return column ? column.type : "text";
  }

  function book() {
    var id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) throw new Error("Script property SHEET_ID is not set. Run setup() first.");
    return SpreadsheetApp.openById(id);
  }

  function sheetFor(tab) {
    if (!tables()[tab]) throw new Error("Unknown tab: " + tab);
    var sheet = book().getSheetByName(tab);
    if (!sheet) throw new Error("Tab " + tab + " is missing. Run setup() first.");
    return sheet;
  }

  function headersOf(sheet) {
    var width = sheet.getLastColumn();
    return width === 0 ? [] : sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  }

  function ensureTab(ss, tab) {
    var sheet = ss.getSheetByName(tab);
    var created = !sheet;
    if (created) sheet = ss.insertSheet(tab);
    var have = headersOf(sheet);
    var missing = tables()[tab].map(function (c) { return c.name; }).filter(function (name) {
      return have.indexOf(name) === -1;
    });
    if (missing.length === 0) return created;
    sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach(function (name, i) {
      if (columnType(tab, name) === "number") return;
      sheet.getRange(1, have.length + 1 + i, sheet.getMaxRows(), 1).setNumberFormat("@");
    });
    sheet.setFrozenRows(1);
    return created;
  }

  // Creates missing tabs and adds missing columns. Returns the names of tabs it created.
  function ensureTabs() {
    var ss = book();
    return Object.keys(tables()).filter(function (tab) { return ensureTab(ss, tab); });
  }

  function encode(type, value) {
    if (value === undefined || value === null) return "";
    if (type === "list") return value.join(", ");
    if (type === "json") return JSON.stringify(value);
    if (type === "bool") return value ? "TRUE" : "FALSE";
    if (type === "number") return value;
    return String(value);
  }

  function decode(type, raw) {
    var empty = raw === "" || raw === null || raw === undefined;
    if (type === "list") {
      return empty ? [] : String(raw).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (type === "bool") return raw === true || String(raw).toUpperCase() === "TRUE";
    if (empty) return null;
    if (type === "number") return Number(raw);
    if (type === "json") return JSON.parse(raw);
    return String(raw);
  }

  function rowsOf(sheet) {
    var headers = headersOf(sheet);
    var height = sheet.getLastRow();
    if (height < 2 || headers.length === 0) return { headers: headers, rows: [] };
    return { headers: headers, rows: sheet.getRange(2, 1, height - 1, headers.length).getValues() };
  }

  function toObject(tab, headers, values) {
    return headers.reduce(function (obj, name, i) {
      obj[name] = decode(columnType(tab, name), values[i]);
      return obj;
    }, {});
  }

  function toValues(tab, headers, obj) {
    return headers.map(function (name) { return encode(columnType(tab, name), obj[name]); });
  }

  function checkColumns(tab, headers, obj) {
    Object.keys(obj).forEach(function (key) {
      if (headers.indexOf(key) === -1) throw new Error("Unknown column " + key + " in " + tab);
    });
  }

  function all(tab) {
    var data = rowsOf(sheetFor(tab));
    return data.rows.map(function (values) { return toObject(tab, data.headers, values); });
  }

  function filter(tab, predicate) {
    return all(tab).filter(predicate);
  }

  function find(tab, column, value) {
    return all(tab).find(function (row) { return row[column] === value; }) || null;
  }

  function insert(tab, obj) {
    var sheet = sheetFor(tab);
    var headers = headersOf(sheet);
    checkColumns(tab, headers, obj);
    var values = toValues(tab, headers, obj);
    sheet.appendRow(values);
    return toObject(tab, headers, values);
  }

  // The first column is the key. Returns the updated row, or null if no row has that key.
  function update(tab, key, patch) {
    var sheet = sheetFor(tab);
    var data = rowsOf(sheet);
    checkColumns(tab, data.headers, patch);
    var index = data.rows.findIndex(function (values) { return String(values[0]) === String(key); });
    if (index === -1) return null;
    var merged = Object.assign(toObject(tab, data.headers, data.rows[index]), patch);
    var values = toValues(tab, data.headers, merged);
    sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
    return toObject(tab, data.headers, values);
  }

  // Runs work() while holding the script lock. Nested calls reuse the lock already held.
  function withLock(work) {
    if (lockDepth > 0) return work();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return SC_Actions.fail("BUSY");
    lockDepth += 1;
    try {
      return work();
    } finally {
      lockDepth -= 1;
      lock.releaseLock();
    }
  }

  function nextSeq(key) {
    if (lockDepth === 0) throw new Error("nextSeq must run inside withLock");
    var row = find("Config", "key", key);
    var next = row ? Number(row.value) + 1 : 1;
    if (row) update("Config", key, { value: String(next) });
    else insert("Config", { key: key, value: String(next) });
    return next;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // Today's date at the school (Chennai), so an application started late in the evening
  // never lands on the wrong day.
  function todayIso() {
    return Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  }

  function newId() {
    return Utilities.getUuid().replace(/-/g, "");
  }

  return Object.freeze({
    tables: tables,
    ensureTabs: ensureTabs,
    all: all,
    filter: filter,
    find: find,
    insert: insert,
    update: update,
    withLock: withLock,
    nextSeq: nextSeq,
    nowIso: nowIso,
    todayIso: todayIso,
    newId: newId,
  });
})();
