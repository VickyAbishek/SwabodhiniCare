// scope: shared
// Turns a password into the key the server checks (main spec §10.1). Runs on the phone, so the
// password itself never leaves it: PBKDF2-SHA256, 600,000 rounds, 16-byte salt, 256-bit key.
export const DEFAULT_ITERATIONS = 600000;

const HEX = /^(?:[0-9a-f]{2})+$/;
const MIN_LENGTH = 8;
const COMMON = new Set([
  "password", "password1", "12345678", "123456789", "1234567890", "11111111", "00000000",
  "qwerty123", "abcd1234", "iloveyou", "welcome1", "admin123", "swabodhini", "swabodhini1", "chennai123",
]);

export function hexToBytes(hex) {
  if (typeof hex !== "string" || !HEX.test(hex)) throw new TypeError("Expected lowercase hex text");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveKey(password, saltHex, iterations = DEFAULT_ITERATIONS, subtle = globalThis.crypto.subtle) {
  let salt;
  try {
    salt = hexToBytes(saltHex);
  } catch (err) {
    throw new TypeError("The salt must be lowercase hex text");
  }
  const material = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

export function newSalt(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// A one-time temporary password: 16 random bytes (128 bits) from the CSPRNG, base64url-encoded so it
// is short enough to copy or read aloud yet far too long to guess. The Admin shows it once; the new
// person sets their own password at first sign-in, so it never has to be remembered for long.
export function newPassword(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns null when the password is acceptable, otherwise a message key for the screen.
export function checkPassword(password) {
  const value = typeof password === "string" ? password : "";
  if (value.trim().length < MIN_LENGTH) return "PASSWORD_TOO_SHORT";
  if (COMMON.has(value.toLowerCase())) return "PASSWORD_TOO_COMMON";
  return null;
}
