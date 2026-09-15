// scope: poc
/* Applications for the POC (main spec §6, §8; POC spec §6, §8): start, open, save and list.
   Answers live in one Sheet column per question; a few summary columns feed lists and reports.
   Every save carries the version it started from, so nobody silently overwrites anyone. */
var SC_Applications = (function () {
  "use strict";

  var PAGE_SIZE = 50;

  function fail(code, details) {
    return SC_Actions.fail(code, details);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Drops answers that are empty, so they are stored as blank cells.
  function stripEmpty(values) {
    return Object.keys(values).reduce(function (out, key) {
      var value = values[key];
      var empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      if (!empty) out[key] = value;
      return out;
    }, {});
  }

  function emptyForm() {
    return SC_FormSchema.allFields().reduce(function (out, field) {
      out[field.id] = null;
      return out;
    }, {});
  }

  function formValues(row) {
    var values = {};
    SC_FormSchema.allFields().forEach(function (field) {
      var value = row[field.id];
      var empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0) ||
        (field.type === "consent" && value === false);
      if (!empty) values[field.id] = value;
    });
    return values;
  }

  // Main spec §5: a SHA-256 of the answers, stored with every decision so a later change shows up.
  function formHash(row) {
    return SC_Crypto.sha256Hex(JSON.stringify(formValues(row)));
  }

  function summaryColumns(values) {
    var s = SC_FormRules.summarize(values);
    return {
      centre: s.centre, applicant_name: s.applicantName || null, dob: s.dob,
      gender: s.gender, suitability: s.suitability, programs: s.programs,
    };
  }

  function view(row) {
    var values = formValues(row);
    return {
      id: row.id, appNo: row.app_no, registrationNo: row.registration_no, status: row.status,
      centre: row.centre, applicantName: row.applicant_name || "", createdBy: row.created_by,
      version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at,
      values: values,
      completion: SC_FormRules.completion(values, SC_Store.todayIso()),
      safetyFlags: SC_FormRules.safetyFlags(values),
    };
  }

  function checkValues(values) {
    var result = SC_FormRules.validate(values, { mode: "draft", today: SC_Store.todayIso() });
    return result.ok ? null : fail("VALIDATION_FAILED", { errors: result.errors });
  }

  // People who can't see an application get NOT_FOUND, so its existence isn't revealed.
  function loadVisible(id, session) {
    if (typeof id !== "string" || !id) return { error: fail("INVALID_REQUEST") };
    var row = SC_Store.find("Applications", "id", id);
    var user = { id: session.user.id, roles: session.user.roles };
    if (!row || !SC_Permissions.canViewApplication(user, { createdBy: row.created_by })) {
      return { error: fail("NOT_FOUND") };
    }
    return { row: row };
  }

  function create(data, session) {
    if (data.values !== undefined && !isPlainObject(data.values)) return fail("INVALID_REQUEST");
    var values = stripEmpty(data.values || {});
    var problem = checkValues(values);
    if (problem) return problem;
    return SC_Store.withLock(function () {
      var year = Number(SC_Store.todayIso().slice(0, 4));
      var now = SC_Store.nowIso();
      var row = Object.assign({
        id: SC_Store.newId(),
        app_no: SC_Numbers.formatAppNo(year, SC_Store.nextSeq("app_seq:" + year)),
        status: SC_Workflow.STATUS.DRAFT, created_by: session.user.id,
        version: 1, created_at: now, updated_at: now,
      }, summaryColumns(values), values);
      var saved = SC_Store.insert("Applications", row);
      SC_Audit.log(session.user.id, "applications.created", "Applications", saved.id, { appNo: saved.app_no });
      return SC_Actions.ok(view(saved));
    });
  }

  function get(data, session) {
    var found = loadVisible(data.id, session);
    if (found.error) return found.error;
    if (found.row.created_by !== session.user.id) {
      SC_Audit.log(session.user.id, "applications.viewed", "Applications", found.row.id, null);
    }
    return SC_Actions.ok(view(found.row));
  }

  function save(data, session) {
    if (!Number.isInteger(data.version) || !isPlainObject(data.values)) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var found = loadVisible(data.id, session);
      if (found.error) return found.error;
      var row = found.row;
      if (row.created_by !== session.user.id || !SC_Workflow.isEditable(row.status)) return fail("NOT_ALLOWED");
      if (row.version !== data.version) return fail("VERSION_CONFLICT", { current: row.version });
      var merged = stripEmpty(Object.assign(formValues(row), data.values));
      var problem = checkValues(merged);
      if (problem) return problem;
      var patch = Object.assign(emptyForm(), merged, summaryColumns(merged), {
        version: row.version + 1, updated_at: SC_Store.nowIso(),
      });
      var saved = SC_Store.update("Applications", row.id, patch);
      SC_Audit.log(session.user.id, "applications.saved", "Applications", row.id, { fields: Object.keys(data.values) });
      return SC_Actions.ok(view(saved));
    });
  }

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

  function listItem(row) {
    return {
      id: row.id, appNo: row.app_no, applicantName: row.applicant_name || "", centre: row.centre,
      status: row.status, createdBy: row.created_by, updatedAt: row.updated_at,
      safetyFlags: SC_FormRules.safetyFlags(formValues(row)),
    };
  }

  function matches(row, data) {
    if (data.status && row.status !== data.status) return false;
    if (data.centre && row.centre !== data.centre) return false;
    if (!data.q) return true;
    var q = String(data.q).trim().toLowerCase();
    return [row.app_no, row.applicant_name].join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function list(data, session) {
    var page = data.page === undefined ? 1 : data.page;
    if (!Number.isInteger(page) || page < 1) return fail("INVALID_REQUEST");
    var user = { id: session.user.id, roles: session.user.roles };
    var rows = SC_Store.filter("Applications", function (row) {
      return SC_Permissions.canViewApplication(user, { createdBy: row.created_by }) && matches(row, data);
    }).sort(function (a, b) {
      if (a.updated_at === b.updated_at) return 0;
      return a.updated_at < b.updated_at ? 1 : -1;
    });
    var start = (page - 1) * PAGE_SIZE;
    return SC_Actions.ok({
      items: rows.slice(start, start + PAGE_SIZE).map(listItem), page: page, pageSize: PAGE_SIZE, total: rows.length,
    });
  }

  return Object.freeze({ create: create, get: get, save: save, submit: submit, list: list, formHash: formHash });
})();

SC_Api.register("applications.create", SC_Applications.create);
SC_Api.register("applications.get", SC_Applications.get);
SC_Api.register("applications.save", SC_Applications.save);
SC_Api.register("applications.submit", SC_Applications.submit);
SC_Api.register("applications.list", SC_Applications.list);
