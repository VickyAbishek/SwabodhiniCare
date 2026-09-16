// scope: poc
/* Small crypto helpers for the POC server (main spec §10.1). The slow password work (PBKDF2)
   happens on the phone; the server only hashes, compares and makes random tokens. */
var SC_Crypto = (function () {
  "use strict";

  // Apps Script returns Java bytes (-128..127); turn them into lowercase hex.
  function bytesToHex(bytes) {
    return bytes.map(function (b) {
      var unsigned = (b + 256) % 256;
      return (unsigned < 16 ? "0" : "") + unsigned.toString(16);
    }).join("");
  }

  function sha256Hex(text) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
  }

  function hmacHex(value, key) {
    return bytesToHex(Utilities.computeHmacSha256Signature(String(value), String(key), Utilities.Charset.UTF_8));
  }

  // getUuid() is java.util.UUID.randomUUID(), backed by SecureRandom: two give 244 random bits.
  function newToken() {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
  }

  // Compares every character, so the time taken doesn't reveal where two strings differ.
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    var diff = a.length ^ b.length;
    var length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i += 1) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  return Object.freeze({
    bytesToHex: bytesToHex,
    sha256Hex: sha256Hex,
    hmacHex: hmacHex,
    newToken: newToken,
    safeEqual: safeEqual,
  });
})();
