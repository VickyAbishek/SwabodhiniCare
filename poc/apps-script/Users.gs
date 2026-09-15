// scope: poc
/* Your own profile, and the Admin's staff accounts (main spec §4, POC spec §7).
   A temporary password is turned into a key in the Admin's browser, just like at sign-in,
   so the server never sees a password. */
var SC_Users = (function () {
  "use strict";

  var LANGS = ["ta", "en"];
  var THEMES = ["light", "dark"];
  var NAME_MAX = 120;
  var HEX_KEY = /^[0-9a-f]{64}$/;
  var HEX_SALT = /^[0-9a-f]{32}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE = /^[6-9]\d{9}$/;

  function fail(code) {
    return SC_Actions.fail(code);
  }

  function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
  }

  function isBlank(value) {
    return value === undefined || value === null || value === "";
  }

  function validName(name) {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= NAME_MAX;
  }

  function validRoles(roles) {
    return Array.isArray(roles) && roles.length > 0 && roles.every(function (role, i) {
      return SC_Permissions.ROLES.indexOf(role) !== -1 && roles.indexOf(role) === i;
    });
  }

  function validCentre(centre) {
    return isBlank(centre) || SC_Numbers.CENTRE_CODES.indexOf(centre) !== -1;
  }

  function validPhone(phone) {
    return isBlank(phone) || (typeof phone === "string" && PHONE.test(phone));
  }

  function validKeyPair(data) {
    return typeof data.salt === "string" && HEX_SALT.test(data.salt) && typeof data.key === "string" && HEX_KEY.test(data.key);
  }

  function staffView(user) {
    return Object.assign(SC_Auth.publicUser(user), { phone: user.phone || null, isActive: Boolean(user.is_active) });
  }

  function meGet(data, session) {
    var user = SC_Store.find("Users", "id", session.user.id);
    return user ? SC_Actions.ok(SC_Auth.publicUser(user)) : fail("NOT_FOUND");
  }

  function meUpdate(data, session) {
    var patch = { updated_at: SC_Store.nowIso() };
    if (data.preferredLang !== undefined) {
      if (LANGS.indexOf(data.preferredLang) === -1) return fail("INVALID_REQUEST");
      patch.preferred_lang = data.preferredLang;
    }
    if (data.preferredTheme !== undefined) {
      if (THEMES.indexOf(data.preferredTheme) === -1) return fail("INVALID_REQUEST");
      patch.preferred_theme = data.preferredTheme;
    }
    return SC_Store.withLock(function () {
      var user = SC_Store.update("Users", session.user.id, patch);
      return user ? SC_Actions.ok(SC_Auth.publicUser(user)) : fail("NOT_FOUND");
    });
  }

  function list() {
    var users = SC_Store.all("Users").map(staffView).sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return SC_Actions.ok(users);
  }

  function validNewUser(data) {
    return EMAIL.test(normalizeEmail(data.email)) && validName(data.name) && validRoles(data.roles) &&
      validCentre(data.centre) && validPhone(data.phone) && validKeyPair(data);
  }

  function create(data) {
    if (!validNewUser(data)) return fail("INVALID_REQUEST");
    var email = normalizeEmail(data.email);
    return SC_Store.withLock(function () {
      var taken = SC_Store.all("Users").some(function (u) { return normalizeEmail(u.email) === email; });
      if (taken) return fail("EMAIL_TAKEN");
      var now = SC_Store.nowIso();
      var user = SC_Store.insert("Users", {
        id: SC_Store.newId(), email: email, name: data.name.trim(), phone: data.phone || null,
        roles: data.roles.slice(), centre: data.centre || null,
        password_hash: SC_Crypto.sha256Hex(data.key), password_salt: data.salt, kdf_iterations: SC_Auth.KDF_ITERATIONS,
        must_change_password: true, preferred_lang: "ta", preferred_theme: "light",
        is_active: true, failed_logins: 0, created_at: now, updated_at: now,
      });
      return SC_Actions.ok(staffView(user));
    });
  }

  // Returns the Sheet patch for an update, or null if anything given is invalid.
  function updatePatch(data) {
    var checks = [
      ["name", "name", validName, function (v) { return v.trim(); }],
      ["phone", "phone", validPhone, function (v) { return v || null; }],
      ["roles", "roles", validRoles, function (v) { return v.slice(); }],
      ["centre", "centre", validCentre, function (v) { return v || null; }],
      ["isActive", "is_active", function (v) { return typeof v === "boolean"; }, function (v) { return v; }],
    ];
    var patch = {};
    for (var i = 0; i < checks.length; i += 1) {
      var value = data[checks[i][0]];
      if (value === undefined) continue;
      if (!checks[i][2](value)) return null;
      patch[checks[i][1]] = checks[i][3](value);
    }
    return patch;
  }

  // The Admin must not deactivate their own account or remove their own Admin role.
  function locksOutSelf(session, id, patch) {
    if (id !== session.user.id) return false;
    return patch.is_active === false || (patch.roles !== undefined && patch.roles.indexOf("ADMIN") === -1);
  }

  function update(data, session) {
    var patch = typeof data.id === "string" ? updatePatch(data) : null;
    if (!patch) return fail("INVALID_REQUEST");
    if (locksOutSelf(session, data.id, patch)) return fail("NOT_ALLOWED");
    patch.updated_at = SC_Store.nowIso();
    return SC_Store.withLock(function () {
      var user = SC_Store.update("Users", data.id, patch);
      if (!user) return fail("NOT_FOUND");
      if (patch.is_active === false) SC_Auth.endSessions(user.id);
      return SC_Actions.ok(staffView(user));
    });
  }

  function resetPassword(data) {
    if (typeof data.id !== "string" || !validKeyPair(data)) return fail("INVALID_REQUEST");
    return SC_Store.withLock(function () {
      var user = SC_Store.update("Users", data.id, {
        password_hash: SC_Crypto.sha256Hex(data.key), password_salt: data.salt, must_change_password: true,
        failed_logins: 0, locked_until: null, updated_at: SC_Store.nowIso(),
      });
      if (!user) return fail("NOT_FOUND");
      SC_Auth.endSessions(user.id);
      return SC_Actions.ok(staffView(user));
    });
  }

  return Object.freeze({
    meGet: meGet,
    meUpdate: meUpdate,
    list: list,
    create: create,
    update: update,
    resetPassword: resetPassword,
  });
})();

SC_Api.register("me.get", SC_Users.meGet);
SC_Api.register("me.update", SC_Users.meUpdate);
SC_Api.register("users.list", SC_Users.list);
// Account changes are wrapped so each one lands in the audit log.
SC_Api.register("users.create", function (data, session) {
  var result = SC_Users.create(data);
  if (result.ok) {
    SC_Audit.log(session.user.id, "users.created", "Users", result.data.id, { email: result.data.email, roles: result.data.roles });
  }
  return result;
});

SC_Api.register("users.update", function (data, session) {
  var result = SC_Users.update(data, session);
  if (result.ok) {
    var changed = ["name", "phone", "roles", "centre", "isActive"]
      .filter(function (key) { return data[key] !== undefined; })
      .map(function (key) { return key === "isActive" ? "is_active" : key; });
    SC_Audit.log(session.user.id, "users.updated", "Users", result.data.id, { changed: changed });
  }
  return result;
});

SC_Api.register("users.resetPassword", function (data, session) {
  var result = SC_Users.resetPassword(data);
  if (result.ok) SC_Audit.log(session.user.id, "users.password_reset", "Users", result.data.id, null);
  return result;
});
