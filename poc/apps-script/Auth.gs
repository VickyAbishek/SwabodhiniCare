// scope: poc
/* Sign-in, sessions and password changes for the POC (main spec §10.1, POC spec §7).
   The phone derives the key with PBKDF2; the server stores only SHA-256(key) and SHA-256(token). */
var SC_Auth = (function () {
  "use strict";

  var KDF_ITERATIONS = 600000;
  var MAX_FAILED = 5;
  var MINUTE_MS = 60 * 1000;
  var LOCK_MS = 15 * MINUTE_MS;
  var IDLE_MS = 12 * 60 * MINUTE_MS;
  var MAX_SESSION_MS = 7 * 24 * 60 * MINUTE_MS;
  var TOUCH_MS = 5 * MINUTE_MS; // how often "last seen" is written, to save Sheet writes
  var HEX_KEY = /^[0-9a-f]{64}$/;
  var HEX_SALT = /^[0-9a-f]{32}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function iso(ms) {
    return new Date(ms).toISOString();
  }

  function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
  }

  function isEmail(email) {
    return email.length > 0 && email.length <= 254 && EMAIL.test(email);
  }

  function isKey(value) {
    return typeof value === "string" && HEX_KEY.test(value);
  }

  function secret() {
    var value = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
    if (!value) throw new Error("Script property HMAC_SECRET is not set. Run setup() first.");
    return value;
  }

  function activeUserByEmail(email) {
    return SC_Store.all("Users").find(function (u) {
      return u.is_active && normalizeEmail(u.email) === email;
    }) || null;
  }

  function publicUser(u) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      roles: u.roles,
      centre: u.centre,
      preferredLang: u.preferred_lang || "ta",
      preferredTheme: u.preferred_theme || "light",
      mustChangePassword: Boolean(u.must_change_password),
    };
  }

  function prelogin(data) {
    var email = normalizeEmail(data.email);
    if (!isEmail(email)) return SC_Actions.fail("INVALID_REQUEST");
    var user = activeUserByEmail(email);
    if (user) return SC_Actions.ok({ salt: user.password_salt, iterations: user.kdf_iterations || KDF_ITERATIONS });
    // Same answer shape for unknown emails, stable per email, so nobody can list staff accounts.
    return SC_Actions.ok({ salt: SC_Crypto.hmacHex("fake-salt:" + email, secret()).slice(0, 32), iterations: KDF_ITERATIONS });
  }

  function recordFailure(user, now) {
    var failed = (user.failed_logins || 0) + 1;
    if (failed >= MAX_FAILED) {
      SC_Store.update("Users", user.id, { failed_logins: 0, locked_until: iso(now + LOCK_MS) });
      return SC_Actions.fail("ACCOUNT_LOCKED");
    }
    SC_Store.update("Users", user.id, { failed_logins: failed });
    return SC_Actions.fail("INVALID_CREDENTIALS");
  }

  function startSession(user, now) {
    var token = SC_Crypto.newToken();
    SC_Store.insert("Sessions", {
      token_hash: SC_Crypto.sha256Hex(token), user_id: user.id,
      created_at: iso(now), last_seen_at: iso(now), expires_at: iso(now + MAX_SESSION_MS),
    });
    return token;
  }

  function login(data) {
    var email = normalizeEmail(data.email);
    if (!isEmail(email) || !isKey(data.key)) return SC_Actions.fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var now = Date.now();
      var user = activeUserByEmail(email);
      if (!user) return SC_Actions.fail("INVALID_CREDENTIALS");
      if (user.locked_until && Date.parse(user.locked_until) > now) return SC_Actions.fail("ACCOUNT_LOCKED");
      if (!SC_Crypto.safeEqual(SC_Crypto.sha256Hex(data.key), user.password_hash)) return recordFailure(user, now);
      SC_Store.update("Users", user.id, { failed_logins: 0, locked_until: null });
      return SC_Actions.ok({ token: startSession(user, now), user: publicUser(user) });
    });
  }

  function sessionRow(token) {
    if (!isKey(token)) return null;
    return SC_Store.find("Sessions", "token_hash", SC_Crypto.sha256Hex(token));
  }

  // A revoked session has expires_at set back to created_at (sign-out, password change).
  function revoke(row) {
    SC_Store.update("Sessions", row.token_hash, { expires_at: row.created_at });
  }

  function isRevoked(row) {
    return row.expires_at <= row.created_at;
  }

  function touch(row, now) {
    // Best effort: if another request holds the lock, the next request will update it.
    SC_Store.withLock(function () {
      SC_Store.update("Sessions", row.token_hash, { last_seen_at: iso(now) });
      return true;
    });
  }

  // → { user } | { error: "SESSION_EXPIRED" } | null. Used by the router for every signed-in action.
  function sessionFor(token) {
    var row = sessionRow(token);
    if (!row || isRevoked(row)) return null;
    var now = Date.now();
    var idleFor = now - Date.parse(row.last_seen_at);
    if (now >= Date.parse(row.expires_at) || idleFor > IDLE_MS) return { error: "SESSION_EXPIRED" };
    var user = SC_Store.find("Users", "id", row.user_id);
    if (!user || !user.is_active) return null;
    if (idleFor > TOUCH_MS) touch(row, now);
    return { user: publicUser(user) };
  }

  function logout(data, session) {
    return SC_Store.withLock(function () {
      var row = sessionRow(session.token);
      if (row && !isRevoked(row)) revoke(row);
      return SC_Actions.ok(null);
    });
  }

  function endOtherSessions(userId, keepHash) {
    SC_Store.filter("Sessions", function (row) {
      return row.user_id === userId && row.token_hash !== keepHash && !isRevoked(row);
    }).forEach(revoke);
  }

  function changePassword(data, session) {
    var valid = isKey(data.currentKey) && isKey(data.newKey) && typeof data.newSalt === "string" && HEX_SALT.test(data.newSalt);
    if (!valid) return SC_Actions.fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var user = SC_Store.find("Users", "id", session.user.id);
      if (!user || !SC_Crypto.safeEqual(SC_Crypto.sha256Hex(data.currentKey), user.password_hash)) {
        return SC_Actions.fail("INVALID_CREDENTIALS");
      }
      var updated = SC_Store.update("Users", user.id, {
        password_hash: SC_Crypto.sha256Hex(data.newKey), password_salt: data.newSalt,
        must_change_password: false, updated_at: iso(Date.now()),
      });
      endOtherSessions(user.id, SC_Crypto.sha256Hex(session.token));
      return SC_Actions.ok(publicUser(updated));
    });
  }

  return Object.freeze({
    KDF_ITERATIONS: KDF_ITERATIONS,
    publicUser: publicUser,
    sessionFor: sessionFor,
    prelogin: prelogin,
    login: login,
    logout: logout,
    changePassword: changePassword,
  });
})();

SC_Api.register("auth.prelogin", SC_Auth.prelogin);
SC_Api.register("auth.login", SC_Auth.login);
SC_Api.register("auth.logout", SC_Auth.logout);
SC_Api.register("auth.changePassword", SC_Auth.changePassword);
