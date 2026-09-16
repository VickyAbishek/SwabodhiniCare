import { test } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { deriveKey, newSalt, checkPassword, DEFAULT_ITERATIONS, hexToBytes, bytesToHex } from "../../public/js/kdf.js";

const nodeKey = (password, saltHex, rounds) =>
  pbkdf2Sync(Buffer.from(password, "utf8"), Buffer.from(saltHex, "hex"), rounds, 32, "sha256").toString("hex");

test("matches the RFC 7914 PBKDF2-HMAC-SHA256 test vector", async () => {
  // P = "passwd", S = "salt", c = 1: the first 32 bytes of the published 64-byte output.
  assert.equal(await deriveKey("passwd", "73616c74", 1), "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc");
});

test("uses 600,000 rounds by default and agrees with Node's PBKDF2", async () => {
  const salt = "0123456789abcdef0123456789abcdef";
  assert.equal(DEFAULT_ITERATIONS, 600000);
  assert.equal(await deriveKey("Kite-mango-4821", salt), nodeKey("Kite-mango-4821", salt, 600000));
});

test("Tamil passwords are hashed as UTF-8", async () => {
  const salt = "fedcba9876543210fedcba9876543210";
  assert.equal(await deriveKey("கடவுச்சொல்2026", salt, 1000), nodeKey("கடவுச்சொல்2026", salt, 1000));
});

test("newSalt gives 16 random bytes as hex", () => {
  const a = newSalt();
  const b = newSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test("hex helpers round-trip", () => {
  assert.equal(bytesToHex(hexToBytes("00ff7f80")), "00ff7f80");
  assert.throws(() => hexToBytes("abc"), /hex/);
  assert.throws(() => hexToBytes("zz"), /hex/);
});

test("a malformed salt is refused", async () => {
  await assert.rejects(deriveKey("secret-password", "not-hex", 1), /salt/);
});

test("password rules: at least 8 characters and not a common password", () => {
  assert.equal(checkPassword("short"), "PASSWORD_TOO_SHORT");
  assert.equal(checkPassword("        "), "PASSWORD_TOO_SHORT");
  assert.equal(checkPassword("Password"), "PASSWORD_TOO_COMMON");
  assert.equal(checkPassword("12345678"), "PASSWORD_TOO_COMMON");
  assert.equal(checkPassword("Swabodhini"), "PASSWORD_TOO_COMMON");
  assert.equal(checkPassword("Kite-mango-4821"), null);
  assert.equal(checkPassword("கடவுச்சொல்2026"), null);
});
