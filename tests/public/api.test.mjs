import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi, loadTransport } from "../../public/js/api.js";

function fakeTransport(replies = {}) {
  let token = null;
  const sent = [];
  return {
    sent,
    getToken: () => token,
    setToken: (value) => { token = value; },
    clearToken: () => { token = null; },
    send: async (action, data) => {
      sent.push({ action, data });
      return replies[action] || { ok: true, data: null, error: null };
    },
  };
}

const fail = (code) => ({ ok: false, data: null, error: { code } });

test("call hands the action and data to the transport and returns its envelope", async () => {
  const transport = fakeTransport({ "me.get": { ok: true, data: { id: "u1" }, error: null } });
  const api = createApi(transport);
  assert.deepEqual(await api.call("me.get", { a: 1 }), { ok: true, data: { id: "u1" }, error: null });
  assert.deepEqual(transport.sent, [{ action: "me.get", data: { a: 1 } }]);
});

test("signing in keeps the token; signing out clears it even if the server fails", async () => {
  const transport = fakeTransport({
    "auth.login": { ok: true, data: { token: "t-123", user: { id: "u1" } }, error: null },
    "auth.logout": fail("NETWORK_ERROR"),
  });
  const api = createApi(transport);
  assert.equal(api.isSignedIn(), false);
  await api.call("auth.login", { email: "a@example.com", key: "k" });
  assert.equal(transport.getToken(), "t-123");
  assert.equal(api.isSignedIn(), true);
  await api.call("auth.logout");
  assert.equal(transport.getToken(), null);
});

test("a failed sign-in does not store anything", async () => {
  const transport = fakeTransport({ "auth.login": fail("INVALID_CREDENTIALS") });
  await createApi(transport).call("auth.login", {});
  assert.equal(transport.getToken(), null);
});

test("an ended session clears the token and tells the page", async () => {
  for (const code of ["NOT_SIGNED_IN", "SESSION_EXPIRED"]) {
    const transport = fakeTransport({ "me.get": fail(code) });
    transport.setToken("old");
    const heard = [];
    const api = createApi(transport, { onSignedOut: (reason) => heard.push(reason) });
    assert.equal((await api.call("me.get")).error.code, code);
    assert.equal(transport.getToken(), null);
    assert.deepEqual(heard, [code]);
  }
});

test("other errors leave the session alone", async () => {
  const transport = fakeTransport({ "users.list": fail("NOT_ALLOWED") });
  transport.setToken("keep");
  const heard = [];
  await createApi(transport, { onSignedOut: (r) => heard.push(r) }).call("users.list");
  assert.equal(transport.getToken(), "keep");
  assert.deepEqual(heard, []);
});

test("loadTransport loads the adapter named in the config", async () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const transport = await loadTransport({ BACKEND: "poc", API_BASE: "/api" }, { fetch: async () => null, storage });
  assert.equal(typeof transport.send, "function");
});

test("loadTransport refuses anything but the known back ends", async () => {
  await assert.rejects(loadTransport({ BACKEND: "../evil", API_BASE: "/api" }, {}), /Unknown back end/);
});
