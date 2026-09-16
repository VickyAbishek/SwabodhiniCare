// scope: poc
/* Audit log (main spec §10.4): who did what, to what, and when.
   Never put keys, password hashes or session tokens in here. */
var SC_Audit = (function () {
  "use strict";

  var PAGE_SIZE = 50;

  function log(userId, action, entity, entityId, details) {
    SC_Store.insert("Audit", {
      id: SC_Store.newId(),
      user_id: userId || null,
      action: action,
      entity: entity || null,
      entity_id: entityId === undefined || entityId === null ? null : String(entityId),
      details: details === undefined ? null : details,
      created_at: SC_Store.nowIso(),
    });
  }

  // Newest first; entries written in the same millisecond keep their reverse insertion order.
  function newestFirst(rows) {
    return rows
      .map(function (row, index) { return { row: row, index: index }; })
      .sort(function (a, b) {
        if (a.row.created_at !== b.row.created_at) return a.row.created_at < b.row.created_at ? 1 : -1;
        return b.index - a.index;
      })
      .map(function (entry) { return entry.row; });
  }

  function list(data) {
    var page = data.page === undefined ? 1 : data.page;
    if (!Number.isInteger(page) || page < 1) return SC_Actions.fail("INVALID_REQUEST");
    var rows = newestFirst(SC_Store.all("Audit"));
    var start = (page - 1) * PAGE_SIZE;
    return SC_Actions.ok({ items: rows.slice(start, start + PAGE_SIZE), page: page, pageSize: PAGE_SIZE, total: rows.length });
  }

  return Object.freeze({ PAGE_SIZE: PAGE_SIZE, log: log, list: list });
})();

SC_Api.register("admin.audit.list", SC_Audit.list);
