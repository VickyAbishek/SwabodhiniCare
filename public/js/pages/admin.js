// scope: shared
// Admin (main spec §4, §10.4): staff accounts, backups and the audit log. Each section appears only
// behind the capability the contract maps it to, and the server re-checks every call, so this screen
// only renders what the router already allowed. Adding a staff member turns a fresh temporary
// password into a key on this phone — exactly as sign-in does — so the server never sees the
// password itself (main §10.1).
import { startPage, showMessage, setBusy, goTo, PAGES } from "../page.js";
import { CONFIG } from "../config.js";
import { deriveKey, newSalt } from "../kdf.js";
import { createConfirmSheet } from "../confirm-sheet.js";

const { SC_Permissions, SC_FormSchema } = window;
const $ = (id) => document.getElementById(id);

const state = { page: null, me: null, staff: null, backups: null, audit: null, auditPage: 1 };

const t = (key, vars) => state.page.t(key, vars);
const lang = () => state.page.prefs().lang;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stamp(text, kind) {
  const s = el("span", `stamp stamp-${kind}`);
  s.textContent = text;
  return s;
}

// A table of already-resolved cells: strings, or nodes such as a status stamp.
function table(headers, rows) {
  const wrap = el("div", "table-wrap");
  const tbl = el("table", "report-table");
  const thead = el("thead");
  const headRow = el("tr");
  headers.forEach((h) => headRow.append(el("th", "", h)));
  thead.append(headRow);
  const tbody = el("tbody");
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((content) => {
      const td = el("td");
      if (content instanceof Node) td.append(content);
      else td.textContent = content === undefined || content === null ? "" : String(content);
      tr.append(td);
    });
    tbody.append(tr);
  });
  tbl.append(thead, tbody);
  wrap.append(tbl);
  return wrap;
}

const shortDate = (iso) => String(iso || "").slice(0, 10);

// ---- Staff ----

function centreLabel(code) {
  return code ? SC_FormSchema.optionLabel("CENTRE", code, lang()) : "—";
}

function drawStaff() {
  $("staff-list").replaceChildren();
  $("staff-empty").hidden = true;
  if (!state.staff) return;
  if (state.staff.length === 0) { $("staff-empty").hidden = false; return; }
  const headers = ["name", "email", "roles", "centre", "active"].map((k) => t(`admin.col.${k}`));
  const rows = state.staff.map((u) => [
    u.name,
    u.email,
    u.roles.map((role) => t(`role.${role}`)).join(", "),
    centreLabel(u.centre),
    u.isActive ? stamp(t("admin.active"), "ok") : stamp(t("admin.inactive"), "bad"),
  ]);
  $("staff-list").append(table(headers, rows));
}

// Rebuilding a select clears its chosen value, so remember and restore it (a language change re-runs
// this to re-translate the option labels).
function fillRoleAndCentre() {
  const role = $("staff-role");
  const centre = $("staff-centre");
  const roleValue = role.value || "THERAPIST";
  const centreValue = centre.value || "";
  role.replaceChildren(...SC_Permissions.ROLES.map((r) => {
    const opt = el("option", "", t(`role.${r}`));
    opt.value = r;
    return opt;
  }));
  const none = el("option", "", t("admin.noCentre"));
  none.value = "";
  centre.replaceChildren(none, ...SC_FormSchema.OPTIONS.CENTRE.map((o) => {
    const opt = el("option", "", lang() === "en" ? o.en : o.ta);
    opt.value = o.value;
    return opt;
  }));
  role.value = roleValue;
  centre.value = centreValue;
}

async function loadStaff() {
  const result = await state.page.api.call("users.list", {});
  if (!result.ok) { showMessage($("message"), state.page.errorMessage(result.error)); return; }
  state.staff = result.data;
  drawStaff();
}

async function createStaff(event) {
  event.preventDefault();
  const button = $("staff-create");
  const tempPassword = newSalt().slice(0, 12);
  const salt = newSalt();
  const key = await deriveKey(tempPassword, salt, CONFIG.KDF_ITERATIONS);
  setBusy(button, t("admin.creating"), true);
  $("temp-password").hidden = true;
  const result = await state.page.api.call("users.create", {
    name: $("staff-name").value,
    email: $("staff-email").value,
    phone: $("staff-phone").value.trim() || null,
    roles: [$("staff-role").value],
    centre: $("staff-centre").value || null,
    salt,
    key,
  });
  if (!result.ok) {
    setBusy(button, "", false);
    showMessage($("message"), state.page.errorMessage(result.error));
    return;
  }
  setBusy(button, "", false);
  $("staff-form").reset();
  fillRoleAndCentre();
  $("temp-password-value").textContent = tempPassword;
  $("temp-password").hidden = false;
  showMessage($("message"), t("admin.created"), "ok");
  await loadStaff();
}

async function copyTempPassword() {
  const value = $("temp-password-value").textContent;
  const button = $("temp-copy");
  try {
    await navigator.clipboard.writeText(value);
  } catch (err) {
    // Clipboard blocked: select the text so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents($("temp-password-value"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  setBusy(button, t("admin.copied"), true);
  setTimeout(() => setBusy(button, "", false), 1500);
}

// ---- Backups ----

function filesCell(row) {
  if (row.status !== "COMPLETE") return "—";
  return `${t("admin.file.sheet")} · ${t("admin.file.xlsx")}`;
}

function drawBackups() {
  $("backups-list").replaceChildren();
  $("backups-empty").hidden = true;
  if (!state.backups) return;
  if (state.backups.length === 0) { $("backups-empty").hidden = false; return; }
  const headers = ["period", "status", "files", "when", "error"].map((k) => t(`admin.col.${k}`));
  const rows = state.backups.map((row) => [
    row.period,
    row.status === "FAILED" ? stamp(t(`admin.status.${row.status}`), "bad") : stamp(t(`admin.status.${row.status}`), "ok"),
    filesCell(row),
    shortDate(row.started_at),
    row.error || "",
  ]);
  $("backups-list").append(table(headers, rows));
}

async function loadBackups() {
  const result = await state.page.api.call("admin.backups.list", {});
  if (!result.ok) { showMessage($("message"), state.page.errorMessage(result.error)); return; }
  state.backups = result.data.items;
  drawBackups();
}

function openBackupConfirm(sheet) {
  sheet.open({
    title: t("admin.confirmBackupTitle"),
    body: t("admin.confirmBackupBody"),
    yes: t("admin.confirmBackupYes"),
    yesClass: "btn-ok",
    onYes: () => runBackupNow(sheet, $("confirm-yes")),
  }, $("backup-now"));
}

async function runBackupNow(sheet, button) {
  setBusy(button, t("admin.backingUp"), true);
  const result = await state.page.api.call("admin.backups.runNow", {});
  if (result.ok) {
    sheet.close();
    showMessage($("message"), t("admin.backupDone"), "ok");
    await loadBackups();
  } else {
    sheet.close();
    showMessage($("message"), state.page.errorMessage(result.error));
  }
  setBusy(button, "", false);
}

// ---- Audit ----

function entityCell(row) {
  if (!row.entity) return "";
  return row.entity_id ? `${row.entity} · ${row.entity_id}` : row.entity;
}

function drawAudit() {
  $("audit-list").replaceChildren();
  $("audit-empty").hidden = true;
  $("audit-pager").hidden = true;
  if (!state.audit) return;
  const items = state.audit.items || [];
  if (items.length === 0) { $("audit-empty").hidden = false; return; }
  const headers = ["when", "who", "action", "entity"].map((k) => t(`admin.col.${k}`));
  const rows = items.map((row) => [
    shortDate(row.created_at),
    el("span", "mono", row.user_id || "—"),
    row.action,
    entityCell(row),
  ]);
  $("audit-list").append(table(headers, rows));

  const totalPages = Math.max(1, Math.ceil(state.audit.total / state.audit.pageSize));
  $("audit-prev").disabled = state.audit.page <= 1;
  $("audit-next").disabled = state.audit.page * state.audit.pageSize >= state.audit.total;
  $("audit-page").textContent = `${state.audit.page} / ${totalPages}`;
  $("audit-pager").hidden = state.audit.total <= state.audit.pageSize;
}

async function loadAudit() {
  const result = await state.page.api.call("admin.audit.list", { page: state.auditPage });
  if (!result.ok) { showMessage($("message"), state.page.errorMessage(result.error)); return; }
  state.audit = result.data;
  drawAudit();
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const message = $("message");
  const me = await page.api.call("me.get");
  if (!me.ok) { showMessage(message, page.errorMessage(me.error)); return; }
  const user = me.data;
  if (user.mustChangePassword) { goTo(PAGES.password); return; }
  page.setPrefs({ lang: user.preferredLang, theme: user.preferredTheme });
  state.page = page;
  state.me = user;

  const canStaff = SC_Permissions.can(user.roles, "users.manage");
  const canBackups = SC_Permissions.can(user.roles, "backups.view");
  const canBackupsRun = SC_Permissions.can(user.roles, "backups.run");
  const canAudit = SC_Permissions.can(user.roles, "audit.view");

  $("staff-section").hidden = !canStaff;
  $("backups-section").hidden = !canBackups;
  $("audit-section").hidden = !canAudit;
  $("backup-now").hidden = !canBackupsRun;
  $("nav-reports").hidden = !SC_Permissions.can(user.roles, "reports.view");

  const sheet = createConfirmSheet();
  sheet.wire();
  fillRoleAndCentre();
  page.onRender(() => { fillRoleAndCentre(); drawStaff(); drawBackups(); drawAudit(); });

  $("staff-form").addEventListener("submit", createStaff);
  $("temp-copy").addEventListener("click", copyTempPassword);
  $("backup-now").addEventListener("click", () => openBackupConfirm(sheet));
  $("audit-prev").addEventListener("click", () => { state.auditPage = Math.max(1, state.auditPage - 1); loadAudit(); });
  $("audit-next").addEventListener("click", () => { state.auditPage += 1; loadAudit(); });

  const jobs = [];
  if (canStaff) jobs.push(loadStaff());
  if (canBackups) jobs.push(loadBackups());
  if (canAudit) jobs.push(loadAudit());
  await Promise.all(jobs);
}

main().catch((err) => console.error("The admin screen could not start", err));
