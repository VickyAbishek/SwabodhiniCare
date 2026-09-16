// scope: shared
// The A4 Individual Assessment Report (main spec §7 R2): one application, all 11 form sections in
// the chosen language, the review trail in order, and the Director's signature. Always light, and
// printed via the browser's Print → Save as PDF (no PDF library).
import { startPage, showMessage } from "../page.js";
import { createFormView } from "../form-view.js";

const { SC_FormSchema, SC_FormRules, SC_Dates } = window;
const $ = (id) => document.getElementById(id);

const view = createFormView({ schema: SC_FormSchema, rules: SC_FormRules, dates: SC_Dates });

const ACTION_LABEL = {
  APPROVE: "action.approve", SEND_BACK: "action.sendBack", REJECT: "action.reject",
  ADMIT: "action.admit", WAITLIST: "action.waitlist", REOPEN: "action.reopen",
};

const state = { page: null, data: null };

// The school's day, not UTC's (the same helper home.js uses).
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(state.page.prefs().lang === "en" ? "en-IN" : "ta-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Resolve a stored value to its label. `options` is the resolved list stepModel returns —
// [{ value, label, selected }] — already in the current language, not a schema list name.
function labelOf(options, value) {
  const found = (options || []).find((o) => o.value === value);
  return found ? found.label : value;
}

function centreLabel(value) {
  const found = SC_FormSchema.OPTIONS.CENTRE.find((o) => o.value === value);
  return found ? (state.page.prefs().lang === "en" ? found.en : found.ta) : value || "";
}

function fieldAnswer(field) {
  const t = state.page.t;
  if (field.type === "consent") return field.value ? t("print.consentSigned") : t("print.consentNotSigned");
  if (field.type === "file") return Array.isArray(field.value) ? String(field.value.length) : "0";
  if (Array.isArray(field.value)) return field.value.map((v) => labelOf(field.options, v)).filter(Boolean).join(", ");
  if (field.value === null || field.value === undefined || field.value === "") return "";
  if (field.options && field.options.length) return labelOf(field.options, field.value);
  return String(field.value);
}

function sections(app) {
  const lang = state.page.prefs().lang;
  return view.stepIds.map((stepId) => {
    const step = view.stepModel(stepId, app.values || {}, today(), lang);
    const section = el("section");
    section.append(el("h2", "", `${step.number}. ${step.title}`));
    const dl = el("dl");
    step.fields.forEach((field) => {
      const answer = fieldAnswer(field);
      if (answer === "" && field.type !== "consent") return; // leave truly empty answers out
      const row = el("div", "fact");
      row.append(el("dt", "", field.label));
      row.append(el("dd", "", answer));
      dl.append(row);
    });
    section.append(dl);
    return section;
  });
}

function reviewTrail(app) {
  const t = state.page.t;
  const box = el("section");
  box.append(el("h2", "", t("print.reviewTrail")));
  (app.approvals || []).forEach((r) => {
    const row = el("div", "review-row");
    row.append(el("div", "who", `${t(`role.${r.stage}`)} · ${r.userName}`));
    row.append(el("div", "", `${t(ACTION_LABEL[r.action] || `action.${r.action.toLowerCase()}`)}${r.comment ? ` — ${r.comment}` : ""}`));
    row.append(el("div", "when", fmt(r.at)));
    box.append(row);
  });
  return box;
}

function signatureBlock() {
  const t = state.page.t;
  const { signature, signerName, signedAt } = state.data;
  const box = el("section");
  box.append(el("h2", "", t("print.signature")));
  if (!signerName) {
    box.append(el("p", "", t("print.notSigned")));
    return box;
  }
  if (signature) {
    const img = el("img");
    img.src = `data:image/png;base64,${signature}`;
    img.alt = signerName;
    const sig = el("div", "signature");
    sig.append(img);
    box.append(sig);
  } else {
    box.append(el("p", "", t("print.noSignature")));
  }
  box.append(el("p", "", t("print.signedBy", { name: signerName, date: fmt(signedAt) })));
  return box;
}

function draw() {
  const t = state.page.t;
  const app = state.data.app;
  const report = $("report");
  report.replaceChildren();

  report.append(el("h1", "", t("print.title")));
  const head = el("div", "print-head");
  head.append(el("span", "", `${t("reports.col.appNo")}: `), el("span", "mono", app.appNo || ""));
  head.append(el("span", "", `${t("reports.col.regNo")}: `), el("span", "mono", app.registrationNo || "—"));
  head.append(el("span", "", `${t("reports.col.centre")}: `), el("span", "", centreLabel(app.centre)));
  head.append(el("span", "", `${t("print.date")}: `), el("span", "", today()));
  report.append(head);

  report.append(el("h2", "", `${t("reports.col.name")}: ${app.applicantName || t("form.untitled")}`));

  sections(app).forEach((section) => report.append(section));
  report.append(reviewTrail(app));
  report.append(signatureBlock());

  $("report").hidden = false;
  $("loading").hidden = true;
  $("back").href = document.referrer || "home.html";
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  state.page = page;
  const id = new URL(window.location.href).searchParams.get("id");
  const result = id ? await page.api.call("reports.get", { name: "print", id }) : { ok: false, error: { code: "NOT_FOUND" } };
  if (!result.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(result.error));
    return;
  }
  state.data = result.data;
  page.onRender(draw);
  $("print-button").addEventListener("click", () => window.print());
}

main().catch((err) => console.error("The print screen could not start", err));
