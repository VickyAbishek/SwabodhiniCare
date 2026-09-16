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
