// scope: poc
/* The POC server's only entry point (POC spec §5). Every call is a POST of
   { action, token, data } as text/plain; every answer is the shared { ok, data, error } envelope.
   Sign-in and capability checks come from the shared contract (SC_Actions) before any handler runs. */
var SC_Api = (function () {
  "use strict";

  var MAX_BODY_CHARS = 8 * 1024 * 1024; // base64 of a 5 MB file, plus room for the rest

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function runHandler(action, handler, data, session) {
    try {
      var result = handler(data, session);
      if (!result || typeof result.ok !== "boolean") {
        throw new Error("handler returned no { ok, data, error } envelope");
      }
      return result;
    } catch (err) {
      console.error("Action " + action + " failed: " + (err && err.message), err && err.stack);
      return SC_Actions.fail("SERVER_ERROR");
    }
  }

  // Until a temporary password is replaced, only these actions are allowed.
  var ALLOWED_BEFORE_PASSWORD_CHANGE = ["auth.changePassword", "auth.logout", "me.get"];

  // Returns { user, token } for a good session, or an error envelope.
  function checkAccess(contract, request, resolveSession) {
    if (contract.auth !== "user") return { user: null };
    var found = request.token ? resolveSession(String(request.token)) : null;
    if (!found) return SC_Actions.fail("NOT_SIGNED_IN");
    if (found.error) return SC_Actions.fail(found.error);
    if (contract.capability && !SC_Permissions.can(found.user.roles, contract.capability)) {
      return SC_Actions.fail("NOT_ALLOWED");
    }
    if (found.user.mustChangePassword && ALLOWED_BEFORE_PASSWORD_CHANGE.indexOf(request.action) === -1) {
      return SC_Actions.fail("PASSWORD_CHANGE_REQUIRED");
    }
    return { user: found.user, token: String(request.token) };
  }

  // options.resolveSession(token) → { user } | { error: "SESSION_EXPIRED" } | null
  function createRouter(options) {
    var handlers = {};

    function register(action, handler) {
      if (!SC_Actions.describe(action)) throw new Error(action + " is not in the API contract");
      if (typeof handler !== "function") throw new Error("The handler for " + action + " must be a function");
      if (handlers[action]) throw new Error(action + " is already registered");
      handlers[action] = handler;
    }

    function handle(request) {
      if (!isPlainObject(request) || typeof request.action !== "string") return SC_Actions.fail("INVALID_REQUEST");
      if (request.data !== undefined && !isPlainObject(request.data)) return SC_Actions.fail("INVALID_REQUEST");
      var contract = SC_Actions.describe(request.action);
      var handler = handlers[request.action];
      if (!contract || !handler) return SC_Actions.fail("UNKNOWN_ACTION");
      var access = checkAccess(contract, request, options.resolveSession);
      if (access.ok === false) return access;
      return runHandler(request.action, handler, request.data || {}, access);
    }

    return Object.freeze({ register: register, handle: handle });
  }

  // SC_Auth is looked up only when a signed-in action arrives, so file load order doesn't matter.
  var defaultRouter = createRouter({
    resolveSession: function (token) {
      return SC_Auth.sessionFor(token);
    },
  });

  function parseBody(e) {
    var text = e && e.postData && e.postData.contents;
    if (typeof text !== "string" || text.length > MAX_BODY_CHARS) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      return null; // answered as INVALID_REQUEST below
    }
  }

  function respond(e, router) {
    var request = parseBody(e);
    var result = request === null ? SC_Actions.fail("INVALID_REQUEST") : (router || defaultRouter).handle(request);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  return Object.freeze({
    createRouter: createRouter,
    register: defaultRouter.register,
    handle: defaultRouter.handle,
    respond: respond,
  });
})();

// Apps Script calls this for every POST to the web app URL.
function doPost(e) {
  return SC_Api.respond(e);
}
