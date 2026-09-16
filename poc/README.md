# POC server (Google Apps Script)

Everything in `poc/` is **`[POC]` scope**: it exists only for Phase 0 and is deleted when the app moves to production. See `docs/architecture/scope-map.md` and the POC spec `docs/superpowers/specs/2026-09-15-swabodhinicare-poc-sheets-design.md`.

| Path | What it is |
|---|---|
| `apps-script/*.gs` | The server: `Api.gs` (router), `Store.gs` (Sheet tables), `Crypto.gs`, `Auth.gs` (sign-in, sessions), `Users.gs` (profile, staff accounts), `Audit.gs`, `Setup.gs` (one-time setup, first Admin) |
| `apps-script/appsscript.json` | Apps Script manifest: Chennai time zone, V8, web app runs as the owner, reachable by anyone (every action except sign-in needs a session token) |
| `scripts/source-order.mjs` | The load order: shared scripts first (in dependency order), then the `.gs` files. Used by the build **and** the tests |
| `scripts/build.mjs` | Writes `build/apps-script/Code.js` (everything in one file, in that order) and `appsscript.json` |

## Test locally (no Google account needed)

```bash
npm test
```

The tests load the same files into Node with in-memory fakes of the Google services (`tests/poc/fakes.js`, `tests/poc/harness.js`).

## Deploy (developer's Google account, test data only)

1. Build: `node poc/scripts/build.mjs` → `build/apps-script/`
2. First time only:
   - `npx @google/clasp login` (opens the browser to sign in to Google)
   - Enable the Apps Script API at https://script.google.com/home/usersettings
   - `npx @google/clasp create --type standalone --title "SwabodhiniCare POC" --rootDir build/apps-script`
3. Push: `npx @google/clasp push`
4. In the Apps Script editor, choose **setup** and press **Run**. Allow the permission it asks for. The execution log shows the **one-time setup code**.
5. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL. It becomes `API_BASE` in `public/js/config.js` (M4).
6. Open the app, choose **First-time setup**, and enter the setup code to create the first Admin. The Admin then creates everyone else, including one test account per role.

After a code change: build, `npx @google/clasp push`, then **Deploy → Manage deployments → Edit → New version**. The URL stays the same.

## Rules

- **Test data only** in the developer's account. Before any real child's data is entered, follow the move checklist in POC spec §12.
- **Never share the data Sheet** or its Drive folder. Staff reach data only through the app.
- `.clasp.json`, `.clasprc.json` and `build/` are git-ignored. Never commit them, or Script Properties values (`HMAC_SECRET`, `SETUP_CODE`).
- The manifest lists only the permissions in use today. Later milestones add Drive (files), Mail (alerts) and triggers (backups) one by one.
