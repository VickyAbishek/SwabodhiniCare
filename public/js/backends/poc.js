// scope: poc
// POC transport (POC spec §5): every call is a POST of { action, token, data } sent as text/plain,
// which avoids a CORS preflight that Apps Script cannot answer. The session token lives in
// localStorage, with an in-memory copy for browsers that block storage.
const TOKEN_KEY = "sc-token";

function fail(code) {
  return { ok: false, data: null, error: { code } };
}

export function createTransport({ apiBase, fetchImpl, storage }) {
  let memoryToken = null;

  function getToken() {
    try {
      const stored = storage.getItem(TOKEN_KEY);
      return stored === null ? memoryToken : stored;
    } catch (err) {
      return memoryToken; // storage blocked: this page keeps the token in memory
    }
  }

  function setToken(token) {
    memoryToken = token;
    try {
      storage.setItem(TOKEN_KEY, token);
    } catch (err) {
      // storage blocked: the in-memory copy is used instead
    }
  }

  function clearToken() {
    memoryToken = null;
    try {
      storage.removeItem(TOKEN_KEY);
    } catch (err) {
      // storage blocked: nothing was stored
    }
  }

  async function send(action, data) {
    let response;
    try {
      response = await fetchImpl(apiBase, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, token: getToken(), data: data || {} }),
      });
    } catch (err) {
      return fail("NETWORK_ERROR");
    }
    let body;
    try {
      body = await response.json();
    } catch (err) {
      return fail("SERVER_ERROR");
    }
    return body && typeof body.ok === "boolean" ? body : fail("SERVER_ERROR");
  }

  return Object.freeze({ send, getToken, setToken, clearToken });
}
