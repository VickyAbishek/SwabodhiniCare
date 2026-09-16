import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "../../public/js/backends/poc.js";
import { CONFIG } from "../../public/js/config.js";

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return reply(url, init);
  };
  impl.calls = calls;
  return impl;
}

const jsonReply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("config defaults: POC back end, demo mode, 600,000 key rounds", () => {
  assert.equal(CONFIG.BACKEND, "poc");
  assert.equal(CONFIG.IS_DEMO, true);
  assert.equal(CONFIG.KDF_ITERATIONS, 600000);
  assert.ok(Object.isFrozen(CONFIG));
});

test("send posts the action, token and data as text/plain JSON", async () => {
  const fetchImpl = fakeFetch(() => jsonReply({ ok: true, data: { hi: 1 }, error: null }));
  const transport = createTransport({ apiBase: "/api", fetchImpl, storage: memoryStorage() });
  transport.setToken("abc");
  assert.deepEqual(await transport.send("me.get", { x: 1 }), { ok: true, data: { hi: 1 }, error: null });
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "/api");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(JSON.parse(init.body), { action: "me.get", token: "abc", data: { x: 1 } });
});

test("with no token and no data, null and {} are sent", async () => {
  const fetchImpl = fakeFetch(() => jsonReply({ ok: true, data: null, error: null }));
  const transport = createTransport({ apiBase: "/api", fetchImpl, storage: memoryStorage() });
  await transport.send("auth.prelogin");
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { action: "auth.prelogin", token: null, data: {} });
});

test("the token is kept in storage and can be cleared", () => {
  const storage = memoryStorage();
  const transport = createTransport({ apiBase: "/api", fetchImpl: fakeFetch(() => null), storage });
  assert.equal(transport.getToken(), null);
  transport.setToken("t1");
  assert.equal(storage.getItem("sc-token"), "t1");
  transport.clearToken();
  assert.equal(transport.getToken(), null);
});

test("network failures and bad replies become error envelopes", async () => {
  const offline = createTransport({ apiBase: "/api", fetchImpl: async () => { throw new TypeError("Failed to fetch"); }, storage: memoryStorage() });
  assert.equal((await offline.send("me.get")).error.code, "NETWORK_ERROR");
  const broken = createTransport({ apiBase: "/api", fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError("x"); } }), storage: memoryStorage() });
  assert.equal((await broken.send("me.get")).error.code, "SERVER_ERROR");
  const odd = createTransport({ apiBase: "/api", fetchImpl: async () => jsonReply({ hello: "world" }), storage: memoryStorage() });
  assert.deepEqual(await odd.send("me.get"), { ok: false, data: null, error: { code: "SERVER_ERROR" } });
});

test("when storage is blocked, the token is kept in memory for this page", async () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  const fetchImpl = fakeFetch(() => jsonReply({ ok: true, data: null, error: null }));
  const transport = createTransport({ apiBase: "/api", fetchImpl, storage: throwing });
  assert.doesNotThrow(() => transport.setToken("t"));
  assert.equal(transport.getToken(), "t");
  assert.equal((await transport.send("me.get")).ok, true);
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).token, "t");
  transport.clearToken();
  assert.equal(transport.getToken(), null);
});
