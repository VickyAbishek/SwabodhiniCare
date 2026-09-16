import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pbkdf2Sync } from "node:crypto";
import { createDevServer } from "../../poc/scripts/dev-server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function start() {
  const dev = createDevServer({ root: ROOT });
  await new Promise((resolve) => dev.server.listen(0, "127.0.0.1", resolve));
  const { port } = dev.server.address();
  return { dev, base: `http://127.0.0.1:${port}` };
}

const stop = (dev) => new Promise((resolve) => dev.server.close(resolve));
const post = (base, body) =>
  fetch(`${base}/api`, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then((r) => r.json());

test("serves app files and shared scripts with the right types, uncached", async () => {
  const { dev, base } = await start();
  try {
    const css = await fetch(`${base}/css/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css/);
    assert.equal(css.headers.get("cache-control"), "no-store");
    const shared = await fetch(`${base}/shared/actions.js`);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get("content-type"), /^text\/javascript/);
    assert.match(await shared.text(), /SC_Actions/);
    const json = await fetch(`${base}/i18n/ta.json`);
    assert.match(json.headers.get("content-type"), /^application\/json/);
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  } finally {
    await stop(dev);
  }
});

test("refuses paths that climb out of public/ or shared/", async () => {
  const { dev, base } = await start();
  try {
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/shared/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e%2fpoc/apps-script/Auth.gs`)).status, 404);
    assert.equal((await fetch(`${base}/shared/form-rules.js`)).status, 200);
  } finally {
    await stop(dev);
  }
});

test("POST /api runs the real POC server, set up and ready for the first Admin", async () => {
  const { dev, base } = await start();
  try {
    assert.match(dev.setupCode, /^[0-9a-f]{12}$/);
    const pre = await post(base, { action: "auth.prelogin", data: { email: "someone@example.com" } });
    assert.equal(pre.ok, true);
    assert.match(pre.data.salt, /^[0-9a-f]{32}$/);
    const salt = "0123456789abcdef0123456789abcdef";
    const key = pbkdf2Sync("Kite-mango-4821", Buffer.from(salt, "hex"), 1000, 32, "sha256").toString("hex");
    const admin = await post(base, {
      action: "setup.firstAdmin",
      data: { code: dev.setupCode, email: "anand.k@example.com", name: "Anand K", salt, key },
    });
    assert.equal(admin.ok, true);
    const login = await post(base, { action: "auth.login", data: { email: "anand.k@example.com", key } });
    assert.match(login.data.token, /^[0-9a-f]{64}$/);
  } finally {
    await stop(dev);
  }
});

test("other methods are refused", async () => {
  const { dev, base } = await start();
  try {
    assert.equal((await fetch(`${base}/css/app.css`, { method: "PUT" })).status, 405);
    assert.equal((await fetch(`${base}/api`)).status, 405);
  } finally {
    await stop(dev);
  }
});
