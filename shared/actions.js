// scope: shared
/* The API contract used by the screens and by both back ends (scope map F5, POC spec §5). */
var SC_Actions = (function () {
  "use strict";

  // auth "public" = no sign-in needed; "user" = signed in. A capability must also pass SC_Permissions.can().
  // Finer checks (owner, workflow stage) happen inside each handler.
  var CONTRACT = {
    "auth.prelogin": { auth: "public" },
    "auth.login": { auth: "public" },
    "auth.logout": { auth: "user" },
    "auth.changePassword": { auth: "user" },
    "me.get": { auth: "user" },
    "me.update": { auth: "user" },
    "users.list": { auth: "user", capability: "users.manage" },
    "users.create": { auth: "user", capability: "users.manage" },
    "users.update": { auth: "user", capability: "users.manage" },
    "users.resetPassword": { auth: "user", capability: "users.manage" },
    "applications.list": { auth: "user" },
    "applications.create": { auth: "user", capability: "application.create" },
    "applications.get": { auth: "user" },
    "applications.save": { auth: "user" },
    "applications.submit": { auth: "user" },
    "applications.review": { auth: "user" },
    "applications.decide": { auth: "user", capability: "decision.final" },
    "applications.reopen": { auth: "user", capability: "application.reopen" },
    "applications.withdraw": { auth: "user" },
    "attachments.upload": { auth: "user" },
    "attachments.get": { auth: "user" },
    "attachments.delete": { auth: "user" },
    "signature.upload": { auth: "user", capability: "decision.final" },
    "reports.get": { auth: "user", capability: "reports.view" },
    "admin.backups.list": { auth: "user", capability: "backups.view" },
    "admin.backups.runNow": { auth: "user", capability: "backups.run" },
    "admin.audit.list": { auth: "user", capability: "audit.view" },
  };

  var MESSAGES = {
    INVALID_REQUEST: ["Something in the request was wrong. Please try again.", "கோரிக்கையில் பிழை உள்ளது. மீண்டும் முயற்சிக்கவும்."],
    UNKNOWN_ACTION: ["This action isn't available.", "இந்தச் செயல் கிடைக்கவில்லை."],
    NOT_SIGNED_IN: ["Please sign in.", "தயவுசெய்து உள்நுழையவும்."],
    SESSION_EXPIRED: ["You were signed out after a period of no use. Please sign in again.", "நீண்ட நேரம் பயன்படுத்தாததால் வெளியேற்றப்பட்டீர்கள். மீண்டும் உள்நுழையவும்."],
    NOT_ALLOWED: ["Your role can't do this.", "உங்கள் பணிப் பொறுப்பில் இதைச் செய்ய முடியாது."],
    INVALID_CREDENTIALS: ["Email or password is not correct. Try again, or ask your Admin.", "மின்னஞ்சல் அல்லது கடவுச்சொல் தவறு. மீண்டும் முயற்சிக்கவும் அல்லது நிர்வாகியிடம் கேளுங்கள்."],
    ACCOUNT_LOCKED: ["Too many wrong tries. Try again in 15 minutes, or ask your Admin.", "பல முறை தவறாக முயன்றீர்கள். 15 நிமிடங்கள் கழித்து முயற்சிக்கவும் அல்லது நிர்வாகியிடம் கேளுங்கள்."],
    VERSION_CONFLICT: ["Someone else updated this form. Tap to reload.", "வேறொருவர் இந்தப் படிவத்தைப் புதுப்பித்துள்ளார். மீண்டும் ஏற்றத் தட்டவும்."],
    BUSY: ["Busy, trying again…", "பரபரப்பாக உள்ளது, மீண்டும் முயல்கிறது…"],
    INVALID_TRANSITION: ["This application can't be moved that way now. Reload to see its latest status.", "இந்த விண்ணப்பத்தை இப்போது அப்படி நகர்த்த முடியாது. சமீபத்திய நிலையைப் பார்க்க மீண்டும் ஏற்றவும்."],
    COMMENT_REQUIRED: ["Please write a comment explaining why.", "காரணத்தை விளக்கி ஒரு கருத்தை எழுதவும்."],
    OWN_APPLICATION: ["You can't review an application you filled in.", "நீங்கள் நிரப்பிய விண்ணப்பத்தை நீங்களே பரிசீலிக்க முடியாது."],
    ALREADY_APPROVED_STAGE: ["You already approved an earlier step of this application. Another person must review this step.", "இந்த விண்ணப்பத்தின் முந்தைய படியில் நீங்கள் ஏற்கனவே ஒப்புதல் அளித்துள்ளீர்கள். இந்தப் படியை வேறொருவர் பரிசீலிக்க வேண்டும்."],
    VALIDATION_FAILED: ["Some answers need attention. They're marked in red.", "சில பதில்களைச் சரிபார்க்க வேண்டும். அவை சிவப்பில் குறிக்கப்பட்டுள்ளன."],
    FILE_TYPE_NOT_ALLOWED: ["Only photos (JPG, PNG) and PDF files can be added.", "புகைப்படங்கள் (JPG, PNG) மற்றும் PDF கோப்புகளை மட்டுமே சேர்க்க முடியும்."],
    FILE_TOO_LARGE: ["This file is larger than 5 MB. Please choose a smaller one.", "இந்தக் கோப்பு 5 MB-ஐ விடப் பெரியது. சிறிய கோப்பைத் தேர்ந்தெடுக்கவும்."],
    NOT_FOUND: ["We couldn't find that. It may have been removed.", "அதைக் கண்டுபிடிக்க முடியவில்லை. அது நீக்கப்பட்டிருக்கலாம்."],
    PASSWORD_CHANGE_REQUIRED: ["Please choose your own password first.", "முதலில் உங்கள் சொந்தக் கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்."],
    EMAIL_TAKEN: ["This email already has an account.", "இந்த மின்னஞ்சலுக்கு ஏற்கனவே கணக்கு உள்ளது."],
    SERVER_ERROR: ["Something went wrong on our side. Please try again.", "எங்கள் பக்கத்தில் ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்."],
  };

  function freezeMap(source, mapEntry) {
    return Object.freeze(
      Object.keys(source).reduce(function (acc, key) {
        acc[key] = Object.freeze(mapEntry(source[key]));
        return acc;
      }, {})
    );
  }

  var ACTIONS = freezeMap(CONTRACT, function (entry) {
    return Object.assign({}, entry);
  });

  var ERRORS = freezeMap(MESSAGES, function (pair) {
    return { en: pair[0], ta: pair[1] };
  });

  function ok(data) {
    return { ok: true, data: data === undefined ? null : data, error: null };
  }

  function fail(code, details) {
    var known = Object.prototype.hasOwnProperty.call(ERRORS, code) ? code : "SERVER_ERROR";
    var message = ERRORS[known];
    return {
      ok: false,
      data: null,
      error: { code: known, message_en: message.en, message_ta: message.ta, details: details === undefined ? null : details },
    };
  }

  function describe(action) {
    return Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  }

  return Object.freeze({ ACTIONS: ACTIONS, ERRORS: ERRORS, ok: ok, fail: fail, describe: describe });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Actions;
}
