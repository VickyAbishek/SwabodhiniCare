// scope: poc
/* The Director's stored signature (POC spec §7 Signatures tab, M7b spec §3.5). One row per user:
   the mark M8 stamps on reports. Re-upload replaces it; unlike a consent signature nothing is kept,
   because this is the Director's identity mark, not a record of what was agreed. The router has
   already enforced decision.final, so these handlers only need to store and read. */
var SC_Signatures = (function () {
  "use strict";

  var ok = SC_Actions.ok;
  var fail = SC_Actions.fail;
  var ROOT_FOLDER = "SwabodhiniCare POC";

  function folderNamed(parent, name) {
    var found = parent.getFoldersByName(name);
    return found.hasNext() ? found.next() : parent.createFolder(name);
  }

  function folderFor() {
    var root = folderNamed(DriveApp.getRootFolder(), ROOT_FOLDER);
    return folderNamed(root, "signatures");
  }

  function stored(userId) {
    return SC_Store.find("Signatures", "user_id", userId);
  }

  function upload(data, session) {
    if (typeof data.base64 !== "string" || !data.base64) return fail("INVALID_REQUEST");
    var bytes = Utilities.base64Decode(data.base64);
    // The signature-pad's own blank check runs client-side (isBlank); the server only guarantees
    // the bytes are a real PNG so Drive never holds something that is not an image.
    if (SC_Attachments.sniff(bytes) !== "image/png") return fail("FILE_TYPE_NOT_ALLOWED");

    var file = folderFor().createFile(Utilities.newBlob(bytes, "image/png", "signature.png"));
    var row = { user_id: session.user.id, drive_file_id: file.getId(), uploaded_at: SC_Store.nowIso() };
    if (stored(session.user.id)) SC_Store.update("Signatures", session.user.id, row);
    else SC_Store.insert("Signatures", row);
    return ok({ uploadedAt: row.uploaded_at });
  }

  function get(data, session) {
    var row = stored(session.user.id);
    if (!row) return ok({ base64: null });
    var blob = DriveApp.getFileById(row.drive_file_id).getBlob();
    return ok({ base64: Utilities.base64Encode(blob.getBytes()), uploadedAt: row.uploaded_at });
  }

  return Object.freeze({ upload: upload, get: get });
})();

SC_Api.register("signature.upload", SC_Signatures.upload);
SC_Api.register("signature.get", SC_Signatures.get);
