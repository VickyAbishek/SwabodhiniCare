# M3: POC Server on Apps Script — Implementation Plan

> **For agentic workers:** use superpowers:executing-plans. TDD per task; code lives in the commits (this plan lists files, interfaces and tests to keep it short).

**Goal:** The `[POC]` Apps Script server: one `doPost` router over the shared API contract, a Sheet-backed table layer, login and sessions, staff accounts, audit log and one-time setup.

**Architecture:** `.gs` files in `poc/apps-script/` share one global scope with the `shared/` scripts (copied in when deploying). Every `.gs` file is tested in Node by loading it, the `shared/` scripts and **in-memory fakes** of `SpreadsheetApp`, `LockService`, `CacheService`, `PropertiesService`, `Utilities` and `ContentService` into a `node:vm` context. No Google account is needed until deployment.

**Spec:** POC spec §4–§8, §12–§13; main spec §4, §10.1; scope map F5–F13.

## Global Constraints
- Every `.gs` file starts `// scope: poc`. No `prod/` references. No npm dependencies (`clasp` runs with `npx`, dev-only).
- Every write runs inside `SC_Store.withLock` (10 s wait → `BUSY`).
- `Utilities.computeDigest` / HMAC return **signed** bytes: convert with `(b + 256) % 256` before hex.
- Session tokens = two `Utilities.getUuid()` values (SecureRandom), hex without dashes; only the SHA-256 is stored.
- Secrets (`HMAC_SECRET`, `SHEET_ID`, `ALERT_EMAILS`) live in Script Properties only.
- Errors are logged with `console.error` and returned as `SERVER_ERROR`; users never see stack traces.

## Sub-milestones

### M3a: Harness, table layer, router
| Task | Files | Tests |
|---|---|---|
| 1. Node harness with fakes | `tests/poc/fakes.js`, `tests/poc/harness.js` | fakes behave like the real services (signed bytes, lock timeout, cache expiry); harness loads `shared/` + `.gs` into a vm context |
| 2. Table layer | `poc/apps-script/Store.gs` → `SC_Store.TABLES`, `ensureTabs()`, `all(tab)`, `find(tab, col, value)`, `insert(tab, row)`, `update(tab, id, patch)`, `nextSeq(key)`, `withLock(fn)`, `nowIso()` | header rows created; Applications columns = fixed columns + every form field id; round-trip of arrays/booleans/numbers; `nextSeq` is gap-free; `withLock` returns `BUSY` on timeout |
| 3. Router | `poc/apps-script/Api.gs` → `doPost(e)`, `SC_Api.register(action, handler)`, `SC_Api.handle(request)` | bad JSON → `INVALID_REQUEST`; unknown action → `UNKNOWN_ACTION`; action not in contract can't be registered; `auth:user` without a valid session → `NOT_SIGNED_IN`; missing capability → `NOT_ALLOWED`; thrown error → `SERVER_ERROR` + `console.error`; response is JSON text |

### M3b: Login and sessions
| Task | Files | Tests |
|---|---|---|
| 4. Crypto helpers | `Crypto.gs` → `sha256Hex`, `hmacHex`, `newToken`, `safeEqual` | known SHA-256 vectors; constant-time compare; token length/charset |
| 5. Auth | `Auth.gs` → `auth.prelogin`, `auth.login`, `auth.logout`, `auth.changePassword`, `SC_Auth.sessionFor(token)` | fake salt stable per unknown email; wrong key counts failures; 5 failures lock 15 min; locked login refused even with the right key; session idle 12 h / max 7 days; logout removes session; must-change-password flag |

### M3c: Staff, audit, setup, seed
| Task | Files | Tests |
|---|---|---|
| 6. Me + users | `Users.gs` → `me.get`, `me.update`, `users.list/create/update/resetPassword` | only Admin; roles validated against `SC_Permissions.ROLES`; deactivation ends sessions; reset sets must-change |
| 7. Audit | `Audit.gs` → `SC_Audit.log(user, action, entity, id, details)`, `admin.audit.list` | logins, user changes recorded; list paged 50 |
| 8. Setup + seed + build | `Setup.gs` (`setup()` creates tabs, centres, `HMAC_SECRET`), `poc/seed/seed.gs` (test account per role, fictional applicants), `poc/scripts/build.mjs` (copies `shared/` + `.gs` into `poc/dist/` for `clasp push`), `poc/README.md` deploy steps | setup is idempotent; build output contains every shared file first |

After M3: TODO ticks, push, PR stacked on M2.
