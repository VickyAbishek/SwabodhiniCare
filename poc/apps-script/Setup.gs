// scope: poc
/* One-time setup for the POC (POC spec §5 "First Admin"). Run setup() from the Apps Script editor;
   it is safe to run again. No password or key is ever stored in the code. */
var SC_Setup = (function () {
  "use strict";

  var CODE = /^[0-9a-f]{12}$/;
  var MAX_CODE_FAILURES = 5;

  function props() {
    return PropertiesService.getScriptProperties();
  }

  function ensureSheet() {
    if (props().getProperty("SHEET_ID")) return;
    var book = SpreadsheetApp.create("SwabodhiniCare POC data");
    props().setProperty("SHEET_ID", book.getId());
  }

  function ensureCentres() {
    var have = SC_Store.all("Centres").map(function (c) { return c.code; });
    return SC_FormSchema.OPTIONS.CENTRE
      .filter(function (o) { return have.indexOf(o.value) === -1; })
      .map(function (o) {
        SC_Store.insert("Centres", { id: SC_Store.newId(), code: o.value, name_en: o.en, name_ta: o.ta, is_active: true });
        return o.value;
      });
  }

  function hasActiveAdmin() {
    return SC_Store.all("Users").some(function (u) { return u.is_active && u.roles.indexOf("ADMIN") !== -1; });
  }

  function clearCode() {
    props().deleteProperty("SETUP_CODE");
    props().deleteProperty("SETUP_FAILURES");
  }

  // A code exists only while there is no active Admin.
  function ensureSetupCode() {
    if (hasActiveAdmin()) {
      clearCode();
      return null;
    }
    var code = props().getProperty("SETUP_CODE");
    if (!code) {
      code = SC_Crypto.newToken().slice(0, 12);
      props().setProperty("SETUP_CODE", code);
      props().setProperty("SETUP_FAILURES", "0");
    }
    return code;
  }

  function run() {
    ensureSheet();
    var tabsCreated = SC_Store.ensureTabs();
    var centresAdded = ensureCentres();
    if (!props().getProperty("HMAC_SECRET")) props().setProperty("HMAC_SECRET", SC_Crypto.newToken());
    var setupCode = ensureSetupCode();
    console.log(setupCode
      ? "First-admin setup code: " + setupCode + " (open the app and choose First-time setup)"
      : "An Admin already exists, so no setup code is needed.");
    return { tabsCreated: tabsCreated, centresAdded: centresAdded, setupCode: setupCode };
  }

  function recordWrongCode() {
    var failures = Number(props().getProperty("SETUP_FAILURES") || 0) + 1;
    if (failures >= MAX_CODE_FAILURES) clearCode();
    else props().setProperty("SETUP_FAILURES", String(failures));
    return SC_Actions.fail("INVALID_CREDENTIALS");
  }

  function firstAdmin(data) {
    var details = Object.assign({}, data, { roles: ["ADMIN"], centre: null });
    if (typeof data.code !== "string" || !CODE.test(data.code) || !SC_Users.validNewUser(details)) {
      return SC_Actions.fail("INVALID_REQUEST");
    }
    return SC_Store.withLock(function () {
      var code = props().getProperty("SETUP_CODE");
      if (!code || hasActiveAdmin()) return SC_Actions.fail("NOT_ALLOWED");
      if (!SC_Crypto.safeEqual(data.code, code)) return recordWrongCode();
      var created = SC_Users.create(details);
      if (!created.ok) return created;
      // The first Admin chose their own password, so no change is needed.
      var admin = SC_Store.update("Users", created.data.id, { must_change_password: false });
      clearCode();
      SC_Audit.log(admin.id, "setup.first_admin", "Users", admin.id, { email: admin.email });
      return SC_Actions.ok(SC_Auth.publicUser(admin));
    });
  }

  return Object.freeze({ run: run, firstAdmin: firstAdmin });
})();

// Run once from the Apps Script editor (select "setup", then Run). Safe to run again.
function setup() {
  return SC_Setup.run();
}

SC_Api.register("setup.firstAdmin", SC_Setup.firstAdmin);
