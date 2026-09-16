// scope: poc
// Local POC server for development: serves public/ and /shared/, and answers POST /api by running the
// real Apps Script code in Node with the test fakes. Data lives in memory and resets when it stops.
// Start-up seeds one fictional application per workflow stage (SEED=0 to skip) and prints the demo
// sign-in details, because nothing can be clicked through until something is waiting in a queue.
// Usage: node poc/scripts/dev-server.mjs   (PORT=8787, HOST=127.0.0.1 by default)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { seedDemoData } from "../seed/demo-applications.mjs";

const require = createRequire(import.meta.url);
const { createContext } = require("../../tests/poc/harness.js");

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

// Returns an absolute path inside base, or null if the request tries to leave it.
function safePath(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (err) {
    return null; // malformed escape: answered with 404
  }
  const full = resolve(base, decoded.replace(/^\/+/, ""));
  return full.startsWith(base + sep) ? full : null;
}

async function serveFile(res, file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, "Not found");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(body);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return send(res, 404, "Not found");
    throw err;
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(req, res, ctx) {
  const contents = await readBody(req);
  const out = ctx.SC_Api.respond({ postData: { contents, type: req.headers["content-type"] || "" } });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(out.getContent());
}

export function createDevServer({ root, seed = false }) {
  const ctx = createContext({ clock: { get ms() { return Date.now(); } }, properties: { SHEET_ID: "" } });
  const { setupCode } = ctx.setup();
  // Seeded into the same store the app reads, so what is printed is what a person signs in to.
  const demo = seed ? seedDemoData(ctx) : null;
  const publicDir = join(root, "public");
  const sharedDir = join(root, "shared");

  async function route(req, res) {
    const path = req.url.split("?")[0];
    if (path === "/api") return req.method === "POST" ? handleApi(req, res, ctx) : send(res, 405, "Method not allowed");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    if (path.startsWith("/shared/")) {
      const file = safePath(sharedDir, path.slice("/shared/".length));
      return file && file.endsWith(".js") ? serveFile(res, file) : send(res, 404, "Not found");
    }
    const file = safePath(publicDir, path.endsWith("/") ? `${path}index.html` : path);
    return file ? serveFile(res, file) : send(res, 404, "Not found");
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error("dev-server:", err);
      if (!res.headersSent) send(res, err.status || 500, err.status ? err.message : "Server error");
      else res.end();
    });
  });

  return { server, ctx, setupCode, demo };
}

// The demo accounts, so somebody opening the app knows who to sign in as and what to expect.
function demoLines(demo) {
  if (!demo) return [];
  return [
    `Demo sign-in — password for every demo account: ${demo.password}`,
    ...demo.people.map((person) => `  ${person.roles.join(", ").padEnd(12)} ${person.email.padEnd(22)} ${person.fullName}`),
    `Demo applications: ${demo.applicationIds.length} seeded, ending at ${demo.statuses.join(", ")}.`,
  ];
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "127.0.0.1";
  const { server, setupCode, demo } = createDevServer({ root, seed: process.env.SEED !== "0" });
  server.listen(port, host, () => {
    console.log(`SwabodhiniCare POC dev server: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`First-admin setup code: ${setupCode}`);
    demoLines(demo).forEach((line) => console.log(line));
    console.log("Data is kept in memory and resets when this server stops. Test data only.");
  });
}
