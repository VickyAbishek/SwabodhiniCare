// scope: shared
/* Roles and what each role may do (main spec §4). Pure data and checks. */
var SC_Permissions = (function () {
  "use strict";

  var ROLES = Object.freeze(["ADMIN", "THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);

  var TABLE = {
    "application.create": ["THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "ADMIN"],
    "application.viewAll": ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR", "ADMIN"],
    "application.reopen": ["DIRECTOR", "ADMIN"],
    "review.therapyHead": ["THERAPY_HEAD"],
    "review.centreHead": ["CENTRE_HEAD"],
    "decision.final": ["DIRECTOR"],
    "reports.view": ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR", "ADMIN"],
    "users.manage": ["ADMIN"],
    "backups.view": ["DIRECTOR", "ADMIN"],
    "backups.run": ["ADMIN"],
    "audit.view": ["DIRECTOR", "ADMIN"],
  };

  var CAPABILITIES = Object.freeze(
    Object.keys(TABLE).reduce(function (acc, key) {
      acc[key] = Object.freeze(TABLE[key].slice());
      return acc;
    }, {})
  );

  function can(roles, capability) {
    var allowed = CAPABILITIES[capability];
    if (!allowed) throw new Error("Unknown capability: " + capability);
    return (roles || []).some(function (role) {
      return allowed.indexOf(role) !== -1;
    });
  }

  function canViewApplication(user, application) {
    return can(user.roles, "application.viewAll") || application.createdBy === user.id;
  }

  function canEditApplication(user, application) {
    return application.createdBy === user.id;
  }

  return Object.freeze({
    ROLES: ROLES,
    CAPABILITIES: CAPABILITIES,
    can: can,
    canViewApplication: canViewApplication,
    canEditApplication: canEditApplication,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Permissions;
}
