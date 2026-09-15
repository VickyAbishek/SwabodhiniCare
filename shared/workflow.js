// scope: shared
/* Application status machine (main spec §5). Pure: callers load the data, this decides. */
var SC_Workflow = (function () {
  "use strict";

  var STATUS = Object.freeze({
    DRAFT: "DRAFT",
    PENDING_THERAPY_HEAD: "PENDING_THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "PENDING_CENTRE_HEAD",
    PENDING_DIRECTOR: "PENDING_DIRECTOR",
    RETURNED: "RETURNED",
    WAITLISTED: "WAITLISTED",
    ADMITTED: "ADMITTED",
    REJECTED: "REJECTED",
    WITHDRAWN: "WITHDRAWN",
  });

  var ACTION = Object.freeze({
    SUBMIT: "SUBMIT",
    APPROVE: "APPROVE",
    SEND_BACK: "SEND_BACK",
    REJECT: "REJECT",
    ADMIT: "ADMIT",
    WAITLIST: "WAITLIST",
    WITHDRAW: "WITHDRAW",
    REOPEN: "REOPEN",
  });

  // Who decides while an application waits in each status.
  var REVIEWER = Object.freeze({
    PENDING_THERAPY_HEAD: "THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "CENTRE_HEAD",
    PENDING_DIRECTOR: "DIRECTOR",
    WAITLISTED: "DIRECTOR",
  });

  // status -> action -> next status. Key order is the button order on screen.
  var TRANSITIONS = Object.freeze({
    DRAFT: Object.freeze({ SUBMIT: "PENDING_THERAPY_HEAD", WITHDRAW: "WITHDRAWN" }),
    RETURNED: Object.freeze({ SUBMIT: "PENDING_THERAPY_HEAD", WITHDRAW: "WITHDRAWN" }),
    PENDING_THERAPY_HEAD: Object.freeze({ APPROVE: "PENDING_CENTRE_HEAD", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    PENDING_CENTRE_HEAD: Object.freeze({ APPROVE: "PENDING_DIRECTOR", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    PENDING_DIRECTOR: Object.freeze({ ADMIT: "ADMITTED", WAITLIST: "WAITLISTED", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    WAITLISTED: Object.freeze({ ADMIT: "ADMITTED" }),
    ADMITTED: Object.freeze({ REOPEN: "RETURNED" }),
  });

  var NEEDS_COMMENT = Object.freeze({ SEND_BACK: true, REJECT: true, REOPEN: true });

  function hasRole(roles, role) {
    return (roles || []).indexOf(role) !== -1;
  }

  // Returns null when the actor may take the action, otherwise an error code.
  function actorError(status, action, ctx) {
    var roles = ctx.actorRoles || [];
    var isOwner = ctx.actorId === ctx.createdBy;
    if (action === "SUBMIT") return isOwner ? null : "NOT_ALLOWED";
    if (action === "WITHDRAW") return isOwner || hasRole(roles, "ADMIN") ? null : "NOT_ALLOWED";
    if (action === "REOPEN") return hasRole(roles, "DIRECTOR") || hasRole(roles, "ADMIN") ? null : "NOT_ALLOWED";
    if (!hasRole(roles, REVIEWER[status])) return "NOT_ALLOWED";
    if (isOwner) return "OWN_APPLICATION";
    if ((ctx.approvedThisRound || []).indexOf(ctx.actorId) !== -1) return "ALREADY_APPROVED_STAGE";
    return null;
  }

  function next(status, action, ctx) {
    var row = TRANSITIONS[status];
    var target = row && Object.prototype.hasOwnProperty.call(row, action) ? row[action] : null;
    if (!target) return { ok: false, status: null, error: "INVALID_TRANSITION" };
    var error = actorError(status, action, ctx);
    if (!error && NEEDS_COMMENT[action] && !String(ctx.comment || "").trim()) error = "COMMENT_REQUIRED";
    return error ? { ok: false, status: null, error: error } : { ok: true, status: target, error: null };
  }

  function availableActions(status, ctx) {
    var row = TRANSITIONS[status] || {};
    return Object.keys(row).filter(function (action) {
      return actorError(status, action, ctx) === null;
    });
  }

  function isEditable(status) {
    return status === STATUS.DRAFT || status === STATUS.RETURNED;
  }

  function reviewerRole(status) {
    return REVIEWER[status] || null;
  }

  return Object.freeze({
    STATUS: STATUS,
    ACTION: ACTION,
    next: next,
    availableActions: availableActions,
    isEditable: isEditable,
    reviewerRole: reviewerRole,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Workflow;
}
