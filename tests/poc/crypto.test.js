const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { createContext } = require("./harness.js");

const ctx = createContext();
const C = ctx.SC_Crypto;

test("bytesToHex turns Apps Script's signed bytes into hex", () => {
  assert.equal(C.bytesToHex([-1, 0, 127, -128, 16]), "ff007f8010");
});

test("sha256Hex matches the published test vectors", () => {
  assert.equal(C.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(C.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256Hex hashes Tamil text as UTF-8", () => {
  const text = "அர்ஜுன் கார்த்திக்";
  assert.equal(C.sha256Hex(text), nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex"));
});

test("hmacHex matches the published HMAC-SHA256 test vector", () => {
  assert.equal(
    C.hmacHex("The quick brown fox jumps over the lazy dog", "key"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
  );
});

test("newToken gives 64 hex characters and never repeats", () => {
  const a = C.newToken();
  const b = C.newToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("safeEqual compares strings without stopping early", () => {
  assert.equal(C.safeEqual("abc123", "abc123"), true);
  assert.equal(C.safeEqual("abc123", "abc124"), false);
  assert.equal(C.safeEqual("abc", "abcd"), false);
  assert.equal(C.safeEqual("", ""), true);
  assert.equal(C.safeEqual(null, "null"), false);
  assert.equal(C.safeEqual(undefined, ""), false);
});
