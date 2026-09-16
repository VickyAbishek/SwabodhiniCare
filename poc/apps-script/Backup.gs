// scope: poc
/* Monthly backups (POC spec §10 F20/F21/F22): copy the data Sheet and an .xlsx into a "Backups"
   Drive folder, keep 24 months, log each run in BackupLog, and email the Admin the result. The time
   trigger and the Admin's "Backup now" both call the one pure core runBackup (design D1). */
var SC_Backup = (function () {
  "use strict";

  var BACKUP_FOLDER = "Backups";
  var RETENTION_MONTHS = 24;
  var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var NAME_PREFIX = "SwabodhiniCare backup";

  // The school's month (Asia/Kolkata), matching SC_Store.todayIso's day logic.
  function currentPeriod(now) {
    return Utilities.formatDate(new Date(now), "Asia/Kolkata", "yyyy-MM");
  }

  function addMonths(period, delta) {
    var parts = period.split("-");
    var total = Number(parts[0]) * 12 + (Number(parts[1]) - 1) + delta;
    var month = ((total % 12) + 12) % 12;
    return Math.floor(total / 12) + "-" + String(month + 1).padStart(2, "0");
  }

  function cutoffPeriod(period) {
    return addMonths(period, -RETENTION_MONTHS);
  }

  function backupFolder() {
    var root = DriveApp.getRootFolder();
    var it = root.getFoldersByName(BACKUP_FOLDER);
    if (it.hasNext()) return it.next();
    return root.createFolder(BACKUP_FOLDER);
  }

  function adminEmail() {
    var admin = SC_Store.all("Users").find(function (u) {
      return u.is_active && u.roles.indexOf("ADMIN") !== -1;
    });
    return admin ? admin.email : "";
  }

  // Trash the Drive files recorded in BackupLog rows older than the retention cutoff. The rows stay
  // for the audit trail; only the files go (design D4).
  function prune(period) {
    var cutoff = cutoffPeriod(period);
    SC_Store.all("BackupLog").forEach(function (row) {
      if (!row.period || row.period >= cutoff) return;
      [row.sheet_copy_id, row.xlsx_file_id].forEach(function (id) {
        if (!id) return;
        try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ }
      });
    });
  }

  function sendResult(period, status, row, error) {
    var email = adminEmail();
    if (!email) return;
    var subject = "Backup " + period + " — " + (status === "COMPLETE" ? "complete" : "failed");
    var body = status === "COMPLETE"
      ? "The monthly backup for " + period + " completed.\nSheet copy: " + row.sheet_copy_id + "\nExcel: " + row.xlsx_file_id
      : "The monthly backup for " + period + " failed: " + error;
    MailApp.sendEmail(email, subject, body);
  }

  // The one pure core: read every tab except Sessions, make both Drive files, prune old ones, log,
  // and email. Returns the BackupLog row. A thrown error becomes a FAILED row + error email.
  function runBackup(period, now) {
    var sheetCopyId = "";
    var xlsxFileId = "";
    var rows = {};
    var status = "COMPLETE";
    var error = "";
    try {
      var counts = {};
      Object.keys(SC_Store.tables()).forEach(function (tab) {
        if (tab === "Sessions") return;
        counts[tab] = SC_Store.all(tab).length;
      });
      rows = counts;

      var sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
      var name = NAME_PREFIX + " " + period;
      var folder = backupFolder();
      var sheetFile = DriveApp.getFileById(sheetId);
      sheetCopyId = sheetFile.makeCopy(name + " (sheet)", folder).getId();
      xlsxFileId = folder.createFile(sheetFile.getBlob().getAs(XLSX_MIME).setName(name + ".xlsx")).getId();

      prune(period);
    } catch (e) {
      status = "FAILED";
      error = e && e.message ? e.message : String(e);
    }
    var row = SC_Store.insert("BackupLog", {
      period: period, status: status, sheet_copy_id: sheetCopyId, xlsx_file_id: xlsxFileId,
      rows: rows, error: error, started_at: now, finished_at: now,
    });
    sendResult(period, status, row, error);
    return row;
  }

  // Newest first; entries written in the same moment keep their reverse insertion order.
  function list(data, session) {
    var rows = SC_Store.all("BackupLog")
      .map(function (row, index) { return { row: row, index: index }; })
      .sort(function (a, b) {
        if ((a.row.started_at || "") !== (b.row.started_at || "")) {
          return (a.row.started_at || "") < (b.row.started_at || "") ? 1 : -1;
        }
        return b.index - a.index;
      })
      .map(function (entry) { return entry.row; });
    return SC_Actions.ok({ items: rows });
  }

  function runNow(data, session) {
    var now = SC_Store.nowIso();
    return SC_Actions.ok(runBackup(currentPeriod(now), now));
  }

  return Object.freeze({
    runBackup: runBackup,
    currentPeriod: currentPeriod,
    cutoffPeriod: cutoffPeriod,
    list: list,
    runNow: runNow,
  });
})();

// The monthly time trigger's entry point. installBackupTrigger schedules it; setup() calls that.
function backupMonthly() {
  var now = new Date().toISOString();
  return SC_Backup.runBackup(SC_Backup.currentPeriod(now), now);
}

function installBackupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "backupMonthly"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("backupMonthly").timeBased().onMonthDay(1).create();
}

SC_Api.register("admin.backups.list", SC_Backup.list);
SC_Api.register("admin.backups.runNow", SC_Backup.runNow);
