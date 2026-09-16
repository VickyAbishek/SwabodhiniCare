// scope: poc
// Local POC server for development: serves public/ and /shared/, and answers POST /api by running the
// real Apps Script code in Node with the test fakes. Data lives in memory and resets when it stops.
// Usage: node poc/scripts/dev-server.mjs   (PORT=8787, HOST=127.0.0.1 by default)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

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

export function createDevServer({ root }) {
  const ctx = createContext({ clock: { get ms() { return Date.now(); } }, properties: { SHEET_ID: "" } });
  const { setupCode } = ctx.setup();
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

  return { server, ctx, setupCode };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "127.0.0.1";
  const { server, setupCode } = createDevServer({ root });
  server.listen(port, host, () => {
    console.log(`SwabodhiniCare POC dev server: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`First-admin setup code: ${setupCode}`);
    console.log("Data is kept in memory and resets when this server stops. Test data only.");
  });
}
