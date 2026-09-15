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
      decidedAt: row.decided_at || null,
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
    // The routing slip is built here and nowhere else: only the application screen reads it, and
    // building it costs a read of the whole Approvals tab plus a user lookup per row. Leaving it in
    // view() would charge that to every action that returns one, save — the autosave — included.
    var shown = view(found.row);
    shown.approvals = approvalsFor(found.row.id);
    return SC_Actions.ok(shown);
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

  // Which stage a waiting application is at, for the routing slip.
  var STAGE_BY_STATUS = {
    PENDING_THERAPY_HEAD: "THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "CENTRE_HEAD",
    PENDING_DIRECTOR: "DIRECTOR",
  };
  var REVIEW_ACTIONS = ["APPROVE", "SEND_BACK", "REJECT"];

  // One person may not approve two stages of the same application. A round starts at each submit
  // and holds every decision taken at or after that instant, so a send-back and resend clears it
  // for free. Waitlisting is not approving, so a Director who waitlisted can still admit later.
  function approversThisRound(applicationId, submittedAt) {
    return SC_Store.filter("Approvals", function (r) {
      if (r.application_id !== applicationId) return false;
      if (r.action !== "APPROVE" && r.action !== "ADMIT") return false;
      return !submittedAt || r.created_at >= submittedAt;
    }).map(function (r) { return r.user_id; });
  }

  // APPROVE, SEND_BACK or REJECT, by the one role whose stage it is. ADMIT and WAITLIST are the
  // Director's alone and need their password, so they go through applications.decide instead.
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
      // Waitlisting is a decision too, so it is stamped here and not only where a number is minted.
      var patch = { status: move.status, updated_at: now, decided_at: now, version: row.version + 1 };
      if (move.status === "ADMITTED" && !row.registration_no) {
        if (SC_Numbers.CENTRE_CODES.indexOf(row.centre) === -1) return fail("INVALID_REQUEST");
        // The school's year, as app_no takes it: a decision in the half hour after midnight in
        // Chennai is still yesterday in UTC, and the year goes into a number we never re-issue.
        var year = Number(SC_Store.todayIso().slice(0, 4));
        patch.registration_no = SC_Numbers.formatRegNo(row.centre, year, SC_Store.nextSeq("reg_seq:" + row.centre + ":" + year));
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

  // The routing slip (POC spec §6): the Approvals rows for this application, oldest first. Each row
  // carries the acting user's id as well as their name: the review screen has to know whether this
  // person has already approved a stage in this round (approversThisRound below decides the round),
  // and two people can share a name where one id cannot.
  function approvalsFor(id) {
    return SC_Store.filter("Approvals", function (r) { return r.application_id === id; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; })
      .map(function (r) {
        var user = SC_Store.find("Users", "id", r.user_id);
        return {
          stage: r.stage, action: r.action, comment: r.comment,
          userId: r.user_id, userName: user ? user.name : "", at: r.created_at,
        };
      });
  }

  // One read of the Users tab, not one per row: this endpoint is polled every minute and each read
  // costs a whole tab.
  function namesById() {
    return SC_Store.all("Users").reduce(function (names, user) {
      names[user.id] = user.name;
      return names;
    }, {});
  }

  // What a queue card shows (main spec §7 R1): the applicant, the age line "19 yrs · Male · Selaiyur"
  // and who sent it. The date of birth travels instead of an age, because an application can sit in
  // the queue across a birthday and a stored age would then be wrong. The sender's name travels too:
  // only an Admin may read the staff list, so a therapist's phone cannot turn a user id into a name.
  function listItem(row, names) {
    return {
      id: row.id, appNo: row.app_no, applicantName: row.applicant_name || "", centre: row.centre,
      dob: row.dob || null, gender: row.gender || null,
      status: row.status, createdBy: row.created_by, createdByName: names[row.created_by] || "",
      updatedAt: row.updated_at,
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
    var shown = rows.slice(start, start + PAGE_SIZE);
    var names = shown.length > 0 ? namesById() : {}; // an empty queue costs no read at all
    return SC_Actions.ok({
      items: shown.map(function (row) { return listItem(row, names); }),
      page: page, pageSize: PAGE_SIZE, total: rows.length,
    });
  }

  return Object.freeze({
    create: create, get: get, save: save, submit: submit, withdraw: withdraw, review: review,
    decide: decide, reopen: reopen, list: list, formHash: formHash,
  });
})();

SC_Api.register("applications.create", SC_Applications.create);
SC_Api.register("applications.get", SC_Applications.get);
SC_Api.register("applications.save", SC_Applications.save);
SC_Api.register("applications.submit", SC_Applications.submit);
SC_Api.register("applications.withdraw", SC_Applications.withdraw);
SC_Api.register("applications.review", SC_Applications.review);
SC_Api.register("applications.decide", SC_Applications.decide);
SC_Api.register("applications.reopen", SC_Applications.reopen);
SC_Api.register("applications.list", SC_Applications.list);
