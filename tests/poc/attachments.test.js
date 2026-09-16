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

test("M7a stores signatures only", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const result = as("priya")("attachments.upload", {
    applicationId: app.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REQUEST");
});
