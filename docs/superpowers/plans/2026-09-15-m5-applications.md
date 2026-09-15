# M5: Applications — Implementation Plan

> **For agentic workers:** use superpowers:executing-plans. TDD for server code and pure browser modules; screens checked in a browser against the dev server.

**Goal:** A therapist can start an application, fill in all 11 steps on a phone with automatic saving, leave and come back, and see progress per step. Other people see only what their role allows. Two people can never silently overwrite each other.

**Spec:** main spec §6 (form), §8 (data model, optimistic locking), §12 (UX); POC spec §6, §8; scope map F2, F11–F13, F19.

## Global Constraints
- Every write inside `SC_Store.withLock`; every save carries the `version` it started from (`VERSION_CONFLICT` otherwise).
- Server validation uses `SC_FormRules.validate(values, { mode: "draft", today })`, with `today` in Asia/Kolkata. Unknown fields are refused.
- Therapists see only their own applications; Heads, Director and Admin see all (`SC_Permissions`). Someone who can't see an application gets `NOT_FOUND`, so its existence isn't revealed.
- Only the person who filled it in can edit it, and only while it is `DRAFT` or `RETURNED` (`SC_Workflow.isEditable`).
- Photos and the consent signature need uploads (M7). Until then those questions show "available in a later update", and submitting (M6) waits for M7.

## M5a: Server (`poc/apps-script/Applications.gs`)
| Action | Behaviour |
|---|---|
| `applications.create` `{ values? }` | New `DRAFT`, `APP-YYYY-NNNN` from a gap-free counter, version 1, audit `applications.created` |
| `applications.get` `{ id }` | `{ id, appNo, status, centre, createdBy, version, …, values, completion, safetyFlags }`; views by anyone but the author are audited |
| `applications.save` `{ id, version, values }` | Merges the given answers (`null` clears one), re-checks the draft, refreshes summary columns, version + 1; audit lists the changed questions |
| `applications.list` `{ status?, centre?, q?, page? }` | Role-scoped summaries, most recently updated first, 50 per page; `q` matches name or application number |

Tests: `tests/poc/applications.test.js`, with `tests/poc/people.js` (one signed-in test person per role, reused in M6).

## M5b: Form screens
| Piece | Files |
|---|---|
| Wizard renderer (pure: schema → field descriptions; answers ↔ inputs) | `public/js/form-view.js` + tests |
| Autosave queue (every 20 s and on step change; "Saving…", "Saved ✓ 10:42", "Not saved"; version conflict) | `public/js/autosave.js` + tests |
| Form screen: one step per screen, progress, Back / Save & Next, all-steps overview | `public/application.html`, `js/pages/application.js` |
| Start from Home: "Start a new application" + my drafts list | `public/home.html`, `js/pages/home.js` |

## M5c: Demo data `[POC]`
- `poc/seed/sample-applications.js` + "Fill with sample data" button behind `IS_DEMO`.
