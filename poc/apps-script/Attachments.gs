// scope: poc
/* Photos, PDFs and signatures in Drive (POC spec §9, main spec §10.3).

   M7a stores the parent's consent signature only; M7b opens this to photos, diagnosis reports
   and the UDID certificate. The file's type is read from its first bytes and never from its
   name or a content type the caller supplies — a private Drive folder is on the other side of
   this check, and a caller who wants to get something past it will happily rename it. */
var SC_Attachments = (function () {
  "use strict";

  var ok = SC_Actions.ok;
  var fail = SC_Actions.fail;

  var MAX_BYTES = 5 * 1024 * 1024;       // main spec §10.3
  var MAX_FILES = 10;                    // main spec §10.3: live attachments per application
  var ROOT_FOLDER = "SwabodhiniCare POC";

  // The file's type is read from its bytes, then checked against the kind's allowed list here
  // (M7b spec §3.3). PHOTO is an image only; a diagnosis report or certificate may also be a PDF.
  var KINDS = {
    PHOTO: ["image/png", "image/jpeg"],
    DIAGNOSIS: ["image/png", "image/jpeg", "application/pdf"],
    UDID: ["image/png", "image/jpeg", "application/pdf"],
    CONSENT_SIGNATURE: ["image/png", "image/jpeg"],
  };

  var MAGIC = [
    { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  ];

  // Utilities.base64Decode hands back SIGNED bytes, so a PNG's 0x89 arrives as -119. Compare
  // unsigned, or every real upload is refused while every test with hand-written bytes passes.
  function sniff(bytes) {
    for (var i = 0; i < MAGIC.length; i++) {
      var want = MAGIC[i].bytes;
      if (bytes.length < want.length) continue;
      var same = true;
      for (var j = 0; j < want.length; j++) {
        if ((bytes[j] & 0xff) !== want[j]) { same = false; break; }
      }
      if (same) return MAGIC[i].mime;
    }
    return null;
  }

  function folderNamed(parent, name) {
    var found = parent.getFoldersByName(name);
    return found.hasNext() ? found.next() : parent.createFolder(name);
  }

  function folderFor(appNo) {
    var root = folderNamed(DriveApp.getRootFolder(), ROOT_FOLDER);
    return folderNamed(folderNamed(root, "attachments"), appNo);
  }

  // Every attachment of an application that has not been deleted, newest first.
  function liveList(applicationId) {
    return SC_Store.filter("Attachments", function (row) {
      return row.application_id === applicationId && !row.deleted_at;
    }).sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
  }

  // The newest attachment of a kind that has not been deleted.
  function liveFor(applicationId, kind) {
    var rows = liveList(applicationId).filter(function (row) { return row.kind === kind; });
    return rows.length > 0 ? rows[0] : null;
  }

  function upload(data, session) {
    var allowed = KINDS[data.kind];
    if (!allowed) return fail("INVALID_REQUEST");
    if (typeof data.base64 !== "string" || !data.base64) return fail("INVALID_REQUEST");

    var app = SC_Applications.loadVisible(data.applicationId, session);
    if (app.error) return app.error;

    var bytes = Utilities.base64Decode(data.base64);
    if (bytes.length > MAX_BYTES) return fail("FILE_TOO_LARGE");
    var mime = sniff(bytes);
    if (!mime || allowed.indexOf(mime) === -1) return fail("FILE_TYPE_NOT_ALLOWED");

    // The 10-file cap (main spec §10.3). A re-sign replaces its own previous mark, so that one
    // does not count against the incoming upload; every other kind is additive.
    var previous = data.kind === "CONSENT_SIGNATURE" ? liveFor(app.row.id, data.kind) : null;
    if (liveList(app.row.id).length - (previous ? 1 : 0) + 1 > MAX_FILES) return fail("TOO_MANY_FILES");

    var name = typeof data.filename === "string" && data.filename ? data.filename : "file";
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = folderFor(app.row.app_no).createFile(blob);

    // A signature is a signature ON something: record what was agreed to at the moment it was
    // given. Only CONSENT_SIGNATURE carries this; M7b's photos are not consented facts.
    var consentPayload = data.kind === "CONSENT_SIGNATURE"
      ? SC_Consent.payload(SC_Applications.valuesOf(app.row))
      : null;

    var row = {
      id: SC_Store.newId(),
      application_id: app.row.id,
      kind: data.kind,
      drive_file_id: file.getId(),
      filename: name,
      mime: mime,
      size: bytes.length,
      uploaded_by: session.user.id,
      created_at: SC_Store.nowIso(),
      deleted_at: null,
      consent_hash: consentPayload ? SC_Crypto.sha256Hex(consentPayload) : null,
      consent_payload: consentPayload,
    };
    // Signing again supersedes the previous mark rather than erasing it (POC spec §9, M7a spec
    // §5.1): what was consented to, and when, has to stay answerable. The other kinds are additive
    // — a second diagnosis report must not erase the first — so this runs for the signature alone.
    if (previous) SC_Store.update("Attachments", previous.id, { deleted_at: SC_Store.nowIso() });

    SC_Store.insert("Attachments", row);
    return ok({ id: row.id, kind: row.kind, filename: row.filename, mime: row.mime, size: row.size });
  }

  function get(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    var row = SC_Store.find("Attachments", "id", data.id);
    if (!row) return fail("NOT_FOUND");
    // The permission lives on the application, so ask about that. Someone who may not see the
    // file is told it does not exist, rather than that it is not theirs.
    var app = SC_Applications.loadVisible(row.application_id, session);
    if (app.error) return app.error;

    var blob = DriveApp.getFileById(row.drive_file_id).getBlob();
    return ok({
      id: row.id, kind: row.kind, filename: row.filename, mime: row.mime, size: row.size,
      base64: Utilities.base64Encode(blob.getBytes()),
    });
  }

  function remove(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    var row = SC_Store.find("Attachments", "id", data.id);
    if (!row || row.deleted_at) return fail("NOT_FOUND");
    // The permission lives on the application, so ask about that — as get() does. The edit check is
    // the one save() uses (Applications.gs:162): the owner, on a file they may still change.
    var app = SC_Applications.loadVisible(row.application_id, session);
    if (app.error) return app.error;
    if (app.row.created_by !== session.user.id || !SC_Workflow.isEditable(app.row.status)) {
      return fail("NOT_ALLOWED");
    }
    SC_Store.update("Attachments", row.id, { deleted_at: SC_Store.nowIso() });
    SC_Audit.log(session.user.id, "attachments.deleted", "Attachments", row.id, { kind: row.kind });
    return ok({ id: row.id });
  }

  return Object.freeze({ upload: upload, get: get, remove: remove, sniff: sniff, liveFor: liveFor, liveList: liveList });
})();

SC_Api.register("attachments.upload", SC_Attachments.upload);
SC_Api.register("attachments.get", SC_Attachments.get);
SC_Api.register("attachments.delete", SC_Attachments.remove);
