const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const HTML = [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]; // "<html>"

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function draft(as, who, values) {
  return as(who)("applications.create", { values: values || {} }).data;
}

function sign(as, who, id, bytes) {
  return as(who)("attachments.upload", {
    applicationId: id, kind: "CONSENT_SIGNATURE", filename: "signature.png", base64: b64(bytes || PNG),
  });
}

test("a signature is stored, typed from its bytes, and fingerprinted", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya", { s2_full_name: "Kavya Selvam", s11_parent_name: "Selvam R" });
  const result = sign(as, "priya", app.id);

  assert.equal(result.ok, true);
  assert.equal(result.data.mime, "image/png");
  assert.equal(result.data.size, PNG.length);

  const row = ctx.SC_Store.find("Attachments", "id", result.data.id);
  assert.equal(row.application_id, app.id);
  assert.equal(row.kind, "CONSENT_SIGNATURE");
  assert.equal(row.deleted_at, null);
  assert.ok(row.drive_file_id, "the file must actually be in Drive");
  assert.ok(row.consent_hash, "a signature carries the fingerprint of what was consented to");
  // The payload it hashed is kept too, so a later check can say WHICH fact moved.
  assert.deepEqual(JSON.parse(row.consent_payload), {
    s11_parent_name: "Selvam R", s2_full_name: "Kavya Selvam",
  });
});

test("a file is refused for what it is, not what it is called", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya");
  // Renaming an HTML file to .png must not get it into a private Drive folder.
  const result = sign(as, "priya", app.id, HTML);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TYPE_NOT_ALLOWED");
  assert.equal(ctx.SC_Store.all("Attachments").length, 0, "nothing may be written when the type is refused");
});

test("sniff reads the three allowed types and refuses the rest", () => {
  const { ctx } = setupPeople();
  assert.equal(ctx.SC_Attachments.sniff(PNG), "image/png");
  assert.equal(ctx.SC_Attachments.sniff(JPEG), "image/jpeg");
  assert.equal(ctx.SC_Attachments.sniff(PDF), "application/pdf");
  assert.equal(ctx.SC_Attachments.sniff(HTML), null);
  assert.equal(ctx.SC_Attachments.sniff([]), null);
  // Apps Script hands back signed bytes, so 0x89 arrives as -119. Unsigned comparison or
  // every PNG on a real deployment is refused while every test still passes.
  assert.equal(ctx.SC_Attachments.sniff([-119, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png");
});

test("a file over 5 MB is refused", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const big = PNG.concat(new Array(5 * 1024 * 1024).fill(0));
  const result = sign(as, "priya", app.id, big);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TOO_LARGE");
});

test("only someone who may see the application may attach to it", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  // Deepa is another therapist: she may not even know the file exists.
  const result = sign(as, "deepa", app.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("photos, diagnosis reports and the UDID certificate are accepted", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  for (const kind of ["PHOTO", "DIAGNOSIS", "UDID"]) {
    const result = as("priya")("attachments.upload", {
      applicationId: app.id, kind, filename: `${kind}.png`, base64: b64(PNG),
    });
    assert.equal(result.ok, true, `${kind} accepted`);
    assert.equal(result.data.kind, kind);
  }
});

test("a PDF is a valid diagnosis report but not a photo", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const diag = as("priya")("attachments.upload", {
    applicationId: app.id, kind: "DIAGNOSIS", filename: "report.pdf", base64: b64(PDF),
  });
  assert.equal(diag.ok, true);
  const photo = as("priya")("attachments.upload", {
    applicationId: app.id, kind: "PHOTO", filename: "face.pdf", base64: b64(PDF),
  });
  assert.equal(photo.ok, false);
  assert.equal(photo.error.code, "FILE_TYPE_NOT_ALLOWED");
});

test("adding a second diagnosis report keeps the first (kinds are additive)", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya");
  const first = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "a.pdf", base64: b64(PDF) });
  const second = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "b.pdf", base64: b64(PDF) });
  assert.equal(second.ok, true);
  assert.equal(ctx.SC_Store.all("Attachments").length, 2);
  assert.equal(ctx.SC_Store.find("Attachments", "id", first.data.id).deleted_at, null, "the first report is not deleted");
});

test("the eleventh attachment is refused", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  for (let i = 0; i < 10; i++) {
    const r = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: `r${i}.png`, base64: b64(PNG) });
    assert.equal(r.ok, true);
  }
  const extra = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "r10.png", base64: b64(PNG) });
  assert.equal(extra.ok, false);
  assert.equal(extra.error.code, "TOO_MANY_FILES");
});

test("re-signing does not count the signature it replaces against the cap", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya", { s11_parent_name: "Selvam R" });
  sign(as, "priya", app.id); // 1 live: the signature
  for (let i = 0; i < 9; i++) {
    assert.equal(as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: `r${i}.png`, base64: b64(PNG) }).ok, true);
  }
  ctx.clock.ms += 1000;
  const again = sign(as, "priya", app.id, JPEG);
  assert.equal(again.ok, true);
  assert.equal(ctx.SC_Store.filter("Attachments", (r) => !r.deleted_at).length, 10, "the replacement keeps the count at 10");
});

test("a signature can be read back by someone who may see the application", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const up = sign(as, "priya", app.id);
  const got = as("priya")("attachments.get", { id: up.data.id });
  assert.equal(got.ok, true);
  assert.equal(got.data.mime, "image/png");
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG);
});

test("someone who may not see the application is not told the file exists", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const up = sign(as, "priya", app.id);
  const got = as("deepa")("attachments.get", { id: up.data.id });
  assert.equal(got.ok, false);
  assert.equal(got.error.code, "NOT_FOUND");
});

test("signing again keeps the mark it replaced", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya", { s11_parent_name: "Selvam R" });
  const first = sign(as, "priya", app.id, PNG);
  ctx.clock.ms += 1000; // so the two rows do not share a created_at
  const second = sign(as, "priya", app.id, JPEG);

  const rows = ctx.SC_Store.all("Attachments");
  assert.equal(rows.length, 2, "the old signature is kept, not overwritten");
  const old = rows.filter(function (r) { return r.id === first.data.id; })[0];
  assert.ok(old.deleted_at, "the replaced signature is marked deleted");
  assert.equal(rows.filter(function (r) { return r.id === second.data.id; })[0].deleted_at, null);
  // And it is still readable, because what was consented to must stay answerable.
  assert.equal(as("priya")("attachments.get", { id: first.data.id }).ok, true);
  // liveFor names the survivor, not whichever row happens to sort first.
  assert.equal(ctx.SC_Attachments.liveFor(app.id, "CONSENT_SIGNATURE").id, second.data.id);
});

test("an unknown attachment id is not found", () => {
  const { as } = setupPeople();
  assert.equal(as("priya")("attachments.get", { id: "no-such-id" }).error.code, "NOT_FOUND");
  assert.equal(as("priya")("attachments.get", { id: "" }).error.code, "INVALID_REQUEST");
});
