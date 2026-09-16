const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("only the Director may store a signature", () => {
  const { as } = setupPeople();
  const refused = as("priya")("signature.upload", { base64: b64(PNG) });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "NOT_ALLOWED");
});

test("the Director's signature is stored and read back", () => {
  const { ctx, as } = setupPeople();
  const up = as("revathi")("signature.upload", { base64: b64(PNG) });
  assert.equal(up.ok, true);
  const row = ctx.SC_Store.find("Signatures", "user_id", "u-revathi");
  assert.ok(row && row.drive_file_id, "the signature is in Drive");
  const got = as("revathi")("signature.get", {});
  assert.equal(got.ok, true);
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG);
});

test("a non-image is refused", () => {
  const { as } = setupPeople();
  const result = as("revathi")("signature.upload", { base64: b64([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TYPE_NOT_ALLOWED");
});

test("re-uploading replaces the stored mark", () => {
  const { ctx, as } = setupPeople();
  as("revathi")("signature.upload", { base64: b64(PNG) });
  ctx.clock.ms += 1000;
  const PNG2 = PNG.concat([0, 0, 0, 0]);
  const second = as("revathi")("signature.upload", { base64: b64(PNG2) });
  assert.equal(second.ok, true);
  assert.equal(ctx.SC_Store.all("Signatures").length, 1, "one row per Director, not one per upload");
  const got = as("revathi")("signature.get", {});
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG2);
});

test("signature.get is empty before anything is stored", () => {
  const { as } = setupPeople();
  const got = as("revathi")("signature.get", {});
  assert.equal(got.ok, true);
  assert.equal(got.data.base64, null);
});
