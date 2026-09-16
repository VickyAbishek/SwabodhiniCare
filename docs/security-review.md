# Security review — SwabodhiniCare POC (M10)

Reviewed against `rules/common/security.md`, ahead of handing the POC to staff. The POC runs on
Google Sheets + Apps Script with a static Cloudflare Pages front end; the production design is a
separate Phase 1 (see `TODO.md`). This review covers the code that exists now; findings that are
POC-accepted trade-offs are recorded here and carried to Phase 1, not fixed in place.

## Checklist

### Hardcoded secrets — none found

- The Apps Script `/exec` URL is supplied at deploy time (`SC_API_BASE` or a prompt in
  `scripts/prepare-deploy.mjs`) and never committed; `public/js/config.deploy.js` is committed empty.
- `HMAC_SECRET` is generated at `setup()` (`SC_Crypto.newToken()`) and stored in Script Properties,
  never written to the repo. `Auth.gs` throws if it is unset.
- The only "password" in source is the **demo** seed (`poc/seed/demo-data.mjs`,
  `demo-pass-2026`), printed by the dev server and shared by fictional accounts only.
- A scan of `public/`, `shared/`, `poc/` and `scripts/` found no API keys, bearer tokens, or other
  secret literals.

### Input validation — present at the boundary

- `auth.prelogin` / `auth.login` reject malformed email/key before touching the store.
- `users.update` whitelists `preferredLang`/`preferredTheme` against `["ta","en"]` / `["light","dark"]`.
- `applications.save` validates every answer's type and range; `form-rules.js` holds the same rules
  the server enforces, so a draft save cannot smuggle a value submit would refuse.
- File uploads are type-checked by their first bytes (`sniff` reads the three allowed types), capped
  at 5 MB for PDFs and 10 attachments per file; the 11th is refused.

### XSS — no sink, and a CSP that backs it

- Rendering uses `textContent` and DOM construction everywhere; `form-render.js` builds questions
  "with the DOM only (no innerHTML)". `i18n.js` sets labels with `textContent`, never HTML. No
  `innerHTML`, `eval`, `new Function`, or `document.write` anywhere in `public/js` or `shared/`.
- `public/_headers` ships `script-src 'self'` (no inline scripts), `object-src 'none'`,
  `frame-ancestors 'none'`, and `base-uri 'self'`, so even a stray sink has little to execute.

### CSRF — not applicable to the POC transport, and flagged for production

- The POC front end sends `{action, token, data}` over `text/plain` with the token in `localStorage`
  — there is no ambient cookie to be replayed, so classic CSRF does not apply.
- **Recorded:** production moves to a `HttpOnly` cookie session (`prod/`), which *will* need explicit
  CSRF protection. Not a POC defect; carried to Phase 1.

### Authentication — sound

- PBKDF2-SHA256, 600,000 rounds, run on the device; only a SHA-256 of the derived key is stored
  server-side, so a dumped Sheet does not yield reusable passwords.
- Unknown emails get a stable fake salt, so nobody can enumerate which emails are accounts.
- Five wrong keys lock the account for 15 minutes; sessions idle-timeout at 12 hours and expire at
  7 days; changing the password ends other sessions; `must_change_password` gates temporary passwords.

### Authorization — enforced server-side per action

- Every `Api.gs` action re-checks capabilities; `applications.list`/`get` are role-scoped and
  `attachments.get`/`delete` check visibility, so a direct call cannot read past the caller's role.
- Separation of duties (one person cannot approve two stages of one application) is enforced in the
  server workflow, not just hidden in the UI.

### Rate limiting — partial (recorded)

- **Recorded:** the POC has per-account lockout but no per-IP login rate limit; a bot can cycle
  emails. This is already a Phase 1 item (`Per-IP login rate limit` in `TODO.md`).

### Error leakage — minimised

- Errors are generic EN/TA sentences; no stack traces reach the client (`SERVER_ERROR` on unexpected
  failures). Wrong key, unknown email and inactive account return the same answer.

## Findings summary

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Info | No per-IP rate limit (lockout is per-account) | Recorded; Phase 1 item |
| 2 | Info | Bearer token in `localStorage`, not `HttpOnly` cookie | POC-accepted; mitigated by no-XSS-sink + strict CSP; cookie + CSRF in Phase 1 |
| 3 | Info | `style-src 'unsafe-inline'` permits inline styles | Accepted; inline styles drive form/DOM layout, no script risk |

No CRITICAL or HIGH findings. Nothing was fixed during this review; the items above are known,
documented POC trade-offs with Phase 1 mitigations already tracked in `TODO.md`.
