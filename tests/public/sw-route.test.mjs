// Tests the pure routing decision the service worker makes for every intercepted fetch.
// Kept free of the `self`/fetch globals so it runs under node:test without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeRequest } from "../../public/js/sw-route.js";

const SELF = "https://swabodhinicare.pages.dev";

test("GET /api is network-only", () => {
  assert.equal(
    routeRequest({ method: "GET", pathname: "/api/applications", origin: SELF, selfOrigin: SELF, mode: "cors" }),
    "network",
  );
});

test("non-GET requests are network-only", () => {
  assert.equal(
    routeRequest({ method: "POST", pathname: "/api/applications", origin: SELF, selfOrigin: SELF, mode: "cors" }),
    "network",
  );
});

test("cross-origin requests are network-only (e.g. the deployed Apps Script /exec)", () => {
  assert.equal(
    routeRequest({
      method: "GET",
      pathname: "/macros/s/AKfycb/exec",
      origin: "https://script.googleusercontent.com",
      selfOrigin: SELF,
      mode: "cors",
    }),
    "network",
  );
});

test("navigations are network-first with an offline-page fallback", () => {
  assert.equal(
    routeRequest({ method: "GET", pathname: "/home.html", origin: SELF, selfOrigin: SELF, mode: "navigate" }),
    "offline",
  );
});

test("same-origin static GET is stale-while-revalidate", () => {
  assert.equal(
    routeRequest({ method: "GET", pathname: "/js/app.js", origin: SELF, selfOrigin: SELF, mode: "same-origin" }),
    "stale-while-revalidate",
  );
});
