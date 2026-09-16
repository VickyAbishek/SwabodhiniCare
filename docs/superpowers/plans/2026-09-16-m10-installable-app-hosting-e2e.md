# M10 — Installable app, hosting and end-to-end — Implementation Plan

> **For agentic workers:** implement this plan **inline, task by task** (not via subagents — token budget is tight). Steps use checkbox (`- [ ]`) syntax for tracking; tick each as it finishes.

Spec: `docs/superpowers/specs/2026-09-16-m10-installable-app-hosting-e2e-design.md`. Branch `feat/m10-installable-app-hosting-e2e`, branched from `feat/m9-backups-alerts-admin`. **Prepare-only** — no remote deploy is run from here.

## Global Constraints

- Scope tags (`[POC]`/`[SHARED]`) follow `docs/architecture/scope-map.md` and are checked by `scripts/check-scope.mjs` (run by `npm test`). `scripts/*` and everything under `public/` except `backends/poc.js` and `seed/` is `[SHARED]`.
- `public/_headers` and `public/manifest.webmanifest` have no `.js`/`.html`/`.css` extension, so `check-scope` skips them (no scope header). `sw.js`, `sw-register.js`, `sw-route.js`, `config.deploy.js` and `offline.html` **do** need `// scope: shared` (or the HTML `<!-- scope: shared -->`).
- `tests/` is not scanned by `check-scope`; `node --test` discovers `tests/**/*.test.mjs` alongside the existing `tests/poc/*.test.js`.
- TDD: write the failing test first, watch it fail, then implement (see `rules/common/testing.md`, 80 % coverage).
- Immutability: build new objects; never mutate shared config. `config.js` spreads `DEPLOY` over its defaults rather than being edited.
- No hardcoded secrets: the Apps Script `/exec` URL is supplied at deploy time (`SC_API_BASE` or a prompt) and never committed.

## File Structure (new or changed)

| File | Task | Scope |
|---|---|---|
| `scripts/deploy-check.mjs` | 1 | `[SHARED]` |
| `tests/scripts/deploy-check.test.mjs` | 1 | tests |
| `.gitignore` (add `public/shared/`) | 1 | — |
| `public/manifest.webmanifest` | 2 | `[SHARED]` (unscanned) |
| `public/sw.js` | 2 | `[SHARED]` |
| `public/js/sw-route.js` | 2 | `[SHARED]` |
| `public/js/sw-register.js` | 2 | `[SHARED]` |
| `public/offline.html` | 2 | `[SHARED]` |
| `public/icon.svg` | 2 | `[SHARED]` (unscanned) |
| `tests/public/sw-route.test.mjs` | 2 | tests |
| `public/_headers` | 3 | `[POC]` (unscanned) |
| `scripts/prepare-deploy.mjs` | 3 | `[SHARED]` |
| `public/js/config.deploy.js` | 3 | `[SHARED]` |
| `public/js/config.js` (merge `DEPLOY`) | 3 | `[SHARED]` |
| `tests/scripts/prepare-deploy.test.mjs` | 3 | tests |
| `docs/runbook.md` (deploy + install section) | 3 | docs |
| `tests/e2e/playwright.config.mjs` | 4 | tests |
| `tests/e2e/helpers.mjs` + `tests/e2e/*.spec.mjs` | 4 | tests |
| `package.json` (`@playwright/test` devDependency) | 4 | — |
| `docs/security-review.md` | 5 | docs |
| `TODO.md` | 5 | docs |

**Not committed:** `docs/demo-credentials.md` — one file listing the demo credentials for every role (gitignored), requested so staff testing has a single reference.

---

### Task 1: `scripts/deploy-check.mjs` — copy `shared/` into `public/shared/` and verify the references

Closes the deploy gap: Cloudflare Pages serves only `public/`, but the HTML loads `/shared/*.js`. The script copies and verifies, and exports a testable core.

- **Consumes:** `node:fs`/`node:path` (dev script — `check-scope.mjs` itself does the same).
- **Produces:** `copyShared(root)` → copies every `shared/*.js` into `public/shared/`; `checkReferences(root)` → walks `public/*.html`, returns the list of `shared/…` `src`s whose file is missing from `shared/`; `run(root)` → both, failing with a non-zero exit on any missing reference.

- [x] **Step 1: Write the failing test** (`tests/scripts/deploy-check.test.mjs`, on a temp dir): `copyShared` copies `a.js`/`b.js` into `public/shared/`; `checkReferences` reports a missing `shared/missing.js` and passes a present one; `run` exits non-zero when a reference is missing.
- [x] **Step 2: Run to verify it fails** (no `deploy-check.mjs`).
- [x] **Step 3: Implement** `scripts/deploy-check.mjs` (`// scope: shared`, the `isMain` pattern from `dev-server.mjs` so it runs when invoked and exports when imported).
- [x] **Step 4: Add `public/shared/` to `.gitignore`.**
- [x] **Step 5: Run the suite and commit** (`feat: deploy-check — copy shared/ into public/shared/ for Pages`).

### Task 2: PWA — manifest, service worker, offline page, registration, icon

The app shell is cached; navigations are network-first with an offline fallback; `/api` is never cached.

- **Consumes:** `public/index.html`/`app.css` (shell); the routing decision is factored into `sw-route.js` so it is unit-testable.
- **Produces:** `manifest.webmanifest`; `sw.js` (cache `swabodhinicare-shell-v1`; `install` → precache `/offline.html`, `/manifest.webmanifest`, `/index.html`; `activate` → delete old + `clients.claim()`; `fetch` → route); `js/sw-route.js` (`routeRequest({ method, pathname, origin, mode })` → `"network"` | `"offline"` | `"stale-while-revalidate"`); `js/sw-register.js` (register `/sw.js` `{type:"module"}` only when hostname is not `127.0.0.1`/`localhost`); `offline.html` (self-contained EN + TA, retry button, no shared JS so it works with a cold cache); `icon.svg`.

- [x] **Step 1: Write the failing test** (`tests/public/sw-route.test.mjs`): `GET` `/api` → `network`; non-`GET` → `network`; cross-origin → `network`; `navigate` → `offline`; same-origin static `GET` → `stale-while-revalidate`.
- [x] **Step 2: Run to verify it fails** (no `sw-route.js`).
- [x] **Step 3: Implement** `js/sw-route.js`, then `sw.js`, `sw-register.js`, `manifest.webmanifest`, `offline.html`, `icon.svg` — and register the SW from `js/page.js` (or import `sw-register.js` there).
- [x] **Step 4: Run the scope check and the suite** (the `sw-route` test passes; scope stays green).
- [x] **Step 5: Verify in a browser** (dev server serves the manifest with the right MIME type; the offline page renders).
- [x] **Step 6: Commit** (`feat: PWA — manifest, app-shell service worker, offline page`).

### Task 3: CSP headers + prepare-deploy + `config.deploy.js` + runbook

A strict CSP for Pages, and a deploy script that sets `API_BASE` without editing `config.js`.

- **Consumes:** the `config.js` shape; the Apps Script web-app origin (`script.google.com` / `script.googleusercontent.com`).
- **Produces:** `public/_headers` (CSP + HSTS + frame/CT/referrer/permissions headers); `scripts/prepare-deploy.mjs` (runs `runDeployCheck`, then writes `config.deploy.js` from `SC_API_BASE` or a prompt); `public/js/config.deploy.js` (committed `export const DEPLOY = {}`); `config.js` spreading `DEPLOY`; the `docs/runbook.md` deploy + install section.

- [ ] **Step 1: Write the failing test** (`tests/scripts/prepare-deploy.test.mjs`): writing `config.deploy.js` from a URL, and `config.js` merging `DEPLOY` (assert `CONFIG.API_BASE` reflects the override and is `"/api"` by default).
- [ ] **Step 2: Run to verify it fails** (no `prepare-deploy.mjs` / no `DEPLOY` merge).
- [ ] **Step 3: Implement** `config.deploy.js` + the `config.js` merge, then `prepare-deploy.mjs`, then `public/_headers`.
- [ ] **Step 4: Extend `docs/runbook.md`** with the deploy steps (deploy-check, prepare-deploy with the `/exec` URL, `wrangler pages deploy public`, `clasp push` + deploy the Apps Script web app, set `API_BASE`) and the install-as-PWA steps.
- [ ] **Step 5: Run the scope check and the suite.**
- [ ] **Step 6: Commit** (`feat: CSP headers + prepare-deploy — set API_BASE via config.deploy.js`).

### Task 4: Committed Playwright E2E suite

A dev-only suite (`@playwright/test`, `workers: 1` because the dev server is one shared in-memory instance) covering the TODO's five scenarios.

- **Consumes:** `node poc/scripts/dev-server.mjs` (seeds one application per workflow stage); the demo people in `poc/seed/demo-data.mjs`.
- **Produces:** `tests/e2e/playwright.config.mjs` (`webServer` boots the dev server, `workers: 1`, `fullyParallel: false`); `tests/e2e/helpers.mjs` (sign-in); `per-role.spec.mjs` (therapist/therapy-head/centre-head/director landing content), `send-back.spec.mjs` (fix + resend → reappears in the reviewer's queue), `tamil.spec.mjs` (labels switch to Tamil), `dark-mode.spec.mjs` (theme persists), `conflict.spec.mjs` (two contexts → second save shows the version-conflict message). Admin is out of scope: there is no seeded admin, and setup needs a per-boot code.

- [ ] **Step 1: Add `@playwright/test` as a devDependency** (`npm install -D @playwright/test`).
- [ ] **Step 2: Write `playwright.config.mjs` + `helpers.mjs`.**
- [ ] **Step 3: Write the five spec files.**
- [ ] **Step 4: Run `npx playwright test`** (install browsers with `npx playwright install` if needed) and fix until green.
- [ ] **Step 5: Confirm `npm test` still passes** (E2E is not part of it) and commit (`feat: Playwright E2E — roles, send-back, Tamil, dark mode, conflict`).

### Task 5: Security review + TODO close-out

A written, checklist-driven review, then tick M10 off.

- **Consumes:** the whole app; the `rules/common/security.md` checklist.
- **Produces:** `docs/security-review.md` (findings + what was fixed vs. recorded); the `TODO.md` update (tick M10, point "Start here" at the POC close-out, note 365 → N tests).

- [ ] **Step 1: Review** inline against the security checklist (hardcoded secrets, input validation, XSS, CSRF, authn/authz, rate limiting, error leakage); fix CRITICAL/HIGH, record the rest.
- [ ] **Step 2: Write `docs/security-review.md`.**
- [ ] **Step 3: Update `TODO.md`** (tick the six M10 lines, update "Start here" and the test count).
- [ ] **Step 4: Run `npm test`** and confirm the full count, 0 fail.
- [ ] **Step 5: Commit** (`docs: security review + tick off M10`), push, and open the PR.

---

## Self-review notes

- `public/shared/` is generated and gitignored; `npm test` must pass whether or not it exists (the copied files carry `// scope: shared` and reference only siblings, so they are safe to scan).
- The service worker must never cache `/api` or non-`GET` requests — data stays network-only.
- `config.deploy.js` is committed empty; `prepare-deploy` overwrites it locally at deploy time (an uncommitted change, by design).
