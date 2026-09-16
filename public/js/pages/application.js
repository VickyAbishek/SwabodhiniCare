// scope: shared
// The 11-step application form: one step per screen, big tap answers, automatic saving and the
// all-steps overview. The server checks every answer; the same shared rules run here for progress.
// A file that was sent back opens with the reviewer's comment above the questions and, in place of
// Save & Next, the button that sends it to the Therapy Head again (main spec §5).
// Uses the SC_* shared scripts loaded by application.html.
import { startPage, showMessage, setBusy, goTo, PAGES } from "../page.js";
import { CONFIG } from "../config.js";
import { createFormView } from "../form-view.js";
import { createAutosave } from "../autosave.js";
import { createConfirmSheet } from "../confirm-sheet.js";
import { renderQuestion } from "../form-render.js";

const { SC_FormSchema, SC_FormRules, SC_Dates } = window;
const view = createFormView({ schema: SC_FormSchema, rules: SC_FormRules, dates: SC_Dates });
const $ = (id) => document.getElementById(id);
const EDITABLE = ["DRAFT", "RETURNED"];
const TEXT_TYPES = ["text", "textarea", "phone", "pincode", "number"];
// The decisions that put a file back on the therapist's desk with a reason. A file is RETURNED
// because one of these was taken, so the banner reads the last of them: what it has to answer now.
const RETURN_ACTIONS = ["SEND_BACK", "REOPEN"];
// Typed answers that show or hide other questions on the same step.
const SHOW_IF_SOURCES = new Set(SC_FormSchema.allFields().filter((f) => f.showIf && f.showIf.field).map((f) => f.showIf.field));

const state = {
  page: null, app: null, values: {}, errors: {}, step: "s1", mode: "step",
  readOnly: false, resend: false, sentBack: null, autosave: null, sheet: null, status: null,
};
// Reloading after a clash is the fix the message asks for, so leaving is meant and not warned about.
let leavingOnPurpose = false;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const lang = () => state.page.prefs().lang;
// "11 Sep", as the mockup's banner dates the comment, in the school's own day.
const shortDate = (iso) => new Date(iso).toLocaleDateString(lang() === "en" ? "en-IN" : "ta-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short",
});

/* What the banner above the questions shows, read once when the file is opened. `applications.get`
   carries the routing slip and `applications.save` — the autosave — does not, so this is taken from
   the loaded copy and kept: reading it off state.app would lose it on the first save.

   `by` is the last send-back or reopen, the decision the therapist has to answer now; an earlier
   round's comment stays on the routing slip, which the review screen shows in full. `therapyHead` is
   the name this file's slip carries for the stage it is going back to — the person who last handled
   it there — because the staff list is the Admin's to read and nobody else can be looked up. */
function returnInfo(app) {
  if (app.status !== "RETURNED") return null;
  const rows = app.approvals || [];
  const head = rows.filter((row) => row.stage === "THERAPY_HEAD").pop();
  return {
    by: rows.filter((row) => RETURN_ACTIONS.includes(row.action)).pop() || null,
    therapyHead: (head && head.userName) || "",
  };
}

function setUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("id", state.app.id);
  url.searchParams.set("step", state.step);
  if (state.mode === "overview") url.searchParams.set("view", "all");
  else url.searchParams.delete("view");
  window.history.replaceState(null, "", url);
}

function errorText(fieldId) {
  const code = state.errors[fieldId];
  if (!code) return "";
  const entry = SC_FormRules.FIELD_ERRORS[code] || SC_FormRules.FIELD_ERRORS.INVALID_VALUE;
  return lang() === "en" ? entry.en : entry.ta;
}

// Updates error messages in place, so nothing the person is typing gets redrawn.
function applyErrors() {
  document.querySelectorAll("#fields .field-error").forEach((box) => {
    const fieldId = box.id.replace(/-error$/, "");
    const text = errorText(fieldId);
    box.textContent = text;
    box.hidden = !text;
    const input = $(fieldId);
    if (input) input.setAttribute("aria-invalid", text ? "true" : "false");
  });
}

function scheduleRedraw() {
  // After the browser has moved focus, redraw and put focus back on the same control.
  setTimeout(() => {
    const focusedId = document.activeElement && document.activeElement.id;
    renderStep();
    const again = focusedId && $(focusedId);
    if (again) again.focus();
  }, 0);
}

function onAnswer(fieldId, raw, redraw) {
  const value = view.parseInput(fieldId, raw);
  const values = Object.assign({}, state.values);
  if (value === null || (Array.isArray(value) && value.length === 0)) delete values[fieldId];
  else values[fieldId] = value;
  state.values = values;
  state.errors = Object.assign({}, state.errors, { [fieldId]: undefined });
  state.autosave.update(values);
  applyErrors();
  renderFixList(); // an answer just typed may be the one a section was still waiting for
  const type = SC_FormSchema.fieldById(fieldId).type;
  if (redraw && (!TEXT_TYPES.includes(type) || SHOW_IF_SOURCES.has(fieldId))) scheduleRedraw();
}

function span(className, text) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

// The banner above the questions: "Sent back", who sent it back and when, and their words in full.
// Nothing of it is drawn for a file that was not sent back, so a draft, a file waiting on a reviewer
// and a settled one all open exactly as they did before.
function renderSentBack() {
  const { t } = state.page;
  const info = state.sentBack;
  $("sent-back").hidden = !info;
  if (!info) return;
  $("sent-back-stamp").textContent = t("status.RETURNED");
  const row = info.by;
  // A returned file has the decision that returned it on its slip; if that row were ever missing,
  // the banner says only what it can rather than naming a stage nobody decided at.
  $("sent-back-by").textContent = row
    ? t("sentBack.by", {
      name: row.userName || t(`role.${row.stage}`),
      role: t(`role.${row.stage}`),
      date: shortDate(row.at),
    })
    : t("status.RETURNED");
  const comment = row ? row.comment || "" : "";
  $("sent-back-comment").textContent = comment;
  $("sent-back-comment").hidden = !comment;
  renderFixList();
}

/* "Steps to fix": the sections the form itself would still not accept, from the same completion rule
   the ticks and the overview read — never a list this screen made up. Both states that are not
   "done" belong here: a section nobody has started is as much work as one with answers missing.
   Nothing left to fix leaves the heading and the list out rather than showing an empty one. */
function renderFixList() {
  if (!state.sentBack) return;
  const steps = SC_FormRules.completion(state.values, today()).steps;
  const toFix = view.stepIds.filter((id) => steps[id] !== "done");
  $("fix-title").hidden = toFix.length === 0;
  $("fix-list").hidden = toFix.length === 0;
  $("fix-list").replaceChildren(...toFix.map((id) => fixRow(id, steps[id])));
}

// One section to fix: its number, its name, and the way there. The row is a button, because going to
// a section saves what is on this screen first, exactly as every other move from here does.
function fixRow(stepId, stepState) {
  const index = view.stepIds.indexOf(stepId);
  const item = document.createElement("li");
  item.dataset.state = stepState;
  const button = document.createElement("button");
  button.type = "button";
  button.append(
    span("node", String(index + 1)),
    span("", view.stepModel(stepId, state.values, today(), lang()).title),
    span("sec-state", state.page.t("sentBack.fix")),
  );
  button.addEventListener("click", () => saveThen(() => show("step", stepId)));
  item.append(button);
  return item;
}

// The one button that moves the file on. On a file that was sent back it sends it to the Therapy Head
// again instead of saving and stepping forward (main spec §5); on a file this person may only read it
// is drawn in the same read-only state every field is — present, and plainly not for them.
function drawPrimary(model) {
  const label = state.resend ? "sentBack.fixAndResend" : model.number === model.total ? "form.finish" : "form.saveNext";
  $("next-btn").textContent = state.page.t(label);
  $("next-btn").disabled = state.readOnly;
}

function renderTicks(current) {
  const steps = SC_FormRules.completion(state.values, today()).steps;
  $("ticks").replaceChildren(...view.stepIds.map((id, i) => {
    const tick = document.createElement("span");
    if (i + 1 === current) tick.className = "now";
    else if (steps[id] === "done") tick.className = "done";
    return tick;
  }));
}

function renderStep() {
  const { t } = state.page;
  const model = view.stepModel(state.step, state.values, today(), lang());
  $("step-label").textContent = t("form.step", { n: model.number, total: model.total });
  $("step-title").textContent = model.title;
  $("app-no").textContent = state.app.appNo;
  renderTicks(model.number);
  const ctx = { t, today: today(), view, readOnly: state.readOnly, errorText, onAnswer };
  $("fields").replaceChildren(...model.fields.map((field) => renderQuestion(field, ctx)));
  drawPrimary(model);
  renderSentBack();
  if (state.status) showStatus(state.status);
}

function renderOverview() {
  const { t } = state.page;
  const progress = SC_FormRules.completion(state.values, today());
  $("overview-title").textContent = state.values.s2_full_name || t("form.untitled");
  $("overview-summary").textContent = `${state.app.appNo} · ${t("form.stepsDone", { done: progress.done, total: progress.total })}`;
  $("step-list").replaceChildren(...view.stepIds.map((id, i) => {
    const item = document.createElement("li");
    item.dataset.state = progress.steps[id];
    const button = document.createElement("button");
    button.type = "button";
    const parts = [["node", String(i + 1)], ["", view.stepModel(id, state.values, today(), lang()).title], ["sec-state", t(`form.state.${progress.steps[id]}`)]];
    parts.forEach(([cls, text]) => {
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = text;
      button.append(span);
    });
    button.addEventListener("click", () => show("step", id));
    item.append(button);
    return item;
  }));
}

function show(mode, step) {
  state.mode = mode;
  if (step) state.step = step;
  $("step-screen").hidden = mode !== "step";
  $("overview-screen").hidden = mode !== "overview";
  $("action-bar").hidden = mode !== "step";
  if (mode === "step") renderStep();
  else renderOverview();
  setUrl();
  window.scrollTo(0, 0);
}

function showStatus(status) {
  state.status = status;
  const { t } = state.page;
  const box = $("save-status");
  const time = status.at ? status.at.toLocaleTimeString(lang() === "en" ? "en-IN" : "ta-IN", { hour: "2-digit", minute: "2-digit" }) : "";
  const texts = { pending: t("form.pending"), saving: t("form.saving"), saved: t("form.saved", { time }), error: t("form.notSaved"), conflict: t("form.notSaved") };
  box.dataset.state = status.state;
  box.textContent = texts[status.state] || "";
  if (status.state === "conflict") showMessage($("message"), state.page.errorMessage({ code: "VERSION_CONFLICT" }));
}

async function saveAnswers(patch, version) {
  const result = await state.page.api.call("applications.save", { id: state.app.id, version, values: patch });
  if (result.ok) state.app = result.data;
  if (!result.ok && result.error.code === "VALIDATION_FAILED") {
    state.errors = result.error.details.errors;
    applyErrors();
  }
  return result;
}

// Saves first; moves on unless an answer needs fixing or someone else saved first.
async function saveThen(next) {
  const result = await state.autosave.flush();
  if (!result.ok && ["VALIDATION_FAILED", "VERSION_CONFLICT"].includes(result.error.code)) {
    if (result.error.code === "VALIDATION_FAILED") showMessage($("message"), state.page.errorMessage(result.error));
    return;
  }
  showMessage($("message"), "");
  next();
}

/* Sending a returned file on (main spec §5, §12). Plain words first: the shared confirmation sheet,
   with what happens next as its body, and Yes sending it. What is on the screen is flushed to the
   server before that, because applications.submit reads the stored answers, not this page's copy. */
function askToResend() {
  const { t } = state.page;
  // T4's sheet names the Therapy Head who will read it: this file's slip carries that name when it
  // has been through the stage. When it has not, the confirmation says what happens without naming
  // anybody, rather than leaving an unfilled {name} in the sentence.
  const body = state.sentBack.therapyHead
    ? t("confirm.sendBody", { name: state.sentBack.therapyHead })
    : t("sentBack.resendNote");
  state.sheet.open({
    title: t("confirm.sendTitle"),
    body,
    yes: t("confirm.yesSend"),
    yesClass: "btn-primary",
    onYes: resend,
  }, $("next-btn"));
}

async function resend() {
  const page = state.page;
  setBusy($("confirm-yes"), page.t("common.working"), true);
  try {
    const flushed = await state.autosave.flush();
    if (!flushed.ok) return refuseResend(flushed);
    const result = await page.api.call("applications.submit", { id: state.app.id });
    if (!result.ok) return refuseResend(result);
    // It has left this person's desk for the Therapy Head: the queue is where they work, as it is
    // after a decision has been taken.
    state.app = result.data;
    state.sheet.close();
    goTo(PAGES.home);
  } catch (err) {
    console.error("The application could not be sent", err);
    refuseResend({ error: { code: "NETWORK_ERROR" } });
  } finally {
    setBusy($("confirm-yes"), "", false);
  }
}

/* A refusal, as it comes: the server's own words, and the answers it named marked where they are
   (main spec §12). A refusal can name a question on another section — the consent signature is the
   one this build cannot fill in yet — so the screen goes to the first of them rather than saying
   "marked in red" over a section with nothing red on it. */
function refuseResend(result) {
  state.sheet.close();
  if (result.error.code === "VALIDATION_FAILED") {
    state.errors = (result.error.details && result.error.details.errors) || {};
    const first = firstErrorStep();
    if (first && first !== state.step) show("step", first); // drawing the section marks its answers
    else applyErrors();
  }
  showMessage($("message"), state.page.errorMessage(result.error));
  // To the top of the screen, not the nearest edge: the action bar is pinned over the bottom of this
  // one, and "nearest" leaves the sentence the refusal just wrote underneath it, where nobody sees it.
  $("message").scrollIntoView({ block: "start" });
}

// The section holding the first answer the server complained about, in the form's own order.
function firstErrorStep() {
  const named = Object.keys(state.errors || {});
  const step = SC_FormSchema.STEPS.find((s) => s.fields.some((f) => named.includes(f.id)));
  return step ? step.id : null;
}

// Demo only [POC]: fills every step with invented answers, then saves through the usual autosave.
// The path comes from config, so this screen never has to know where the POC code lives.
async function fillWithSample() {
  const answers = await import(`../${CONFIG.SAMPLE_DATA}.js`);
  const values = Object.assign({}, state.values, answers.SAMPLE_APPLICANT);
  state.values = values;
  state.errors = {};
  state.autosave.update(values);
  show(state.mode);
}

function wireButtons() {
  const stepAt = (offset) => view.stepIds[view.stepIds.indexOf(state.step) + offset];
  $("next-btn").addEventListener("click", () => {
    if (state.resend) {
      askToResend();
      return;
    }
    saveThen(() => (stepAt(1) ? show("step", stepAt(1)) : show("overview")));
  });
  $("back-btn").addEventListener("click", () => saveThen(() => (stepAt(-1) ? show("step", stepAt(-1)) : goTo(PAGES.home))));
  $("overview-btn").addEventListener("click", () => saveThen(() => show("overview")));
  $("fill-sample").addEventListener("click", () => {
    fillWithSample().catch((err) => {
      console.error("The sample answers could not be loaded", err);
      showMessage($("message"), state.page.errorMessage({ code: "SERVER_ERROR" }));
    });
  });
  $("message").addEventListener("click", () => {
    if (!state.status || state.status.state !== "conflict") return;
    leavingOnPurpose = true;
    window.location.reload();
  });
  window.addEventListener("beforeunload", (event) => {
    if (leavingOnPurpose || !state.autosave.hasUnsaved()) return;
    state.autosave.flush();
    event.preventDefault();
  });
  state.sheet.wire();
}

async function load(page) {
  const params = new URL(window.location.href).searchParams;
  const id = params.get("id");
  const result = id ? await page.api.call("applications.get", { id }) : await page.api.call("applications.create", {});
  if (!result.ok) {
    $("step-screen").hidden = false;
    showMessage($("message"), page.errorMessage(result.error));
    return null;
  }
  const step = view.stepIds.includes(params.get("step")) ? params.get("step") : "s1";
  return { app: result.data, step, mode: params.get("view") === "all" ? "overview" : "step" };
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  state.page = page;
  const [me, loaded] = [await page.api.call("me.get"), await load(page)];
  if (!loaded || !me.ok) return;
  state.app = loaded.app;
  state.values = Object.assign({}, loaded.app.values);
  state.step = loaded.step;
  state.mode = loaded.mode;
  state.readOnly = loaded.app.createdBy !== me.data.id || !EDITABLE.includes(loaded.app.status);
  state.sentBack = returnInfo(loaded.app);
  // Only the file's own therapist sends it again: anyone else reading a returned file sees the
  // reason, and nothing on the screen pretends they could act on it.
  state.resend = Boolean(state.sentBack) && !state.readOnly;
  state.autosave = createAutosave({ diff: view.changedValues, save: saveAnswers, onStatus: showStatus });
  state.autosave.start({ values: state.values, version: loaded.app.version });
  state.sheet = createConfirmSheet();
  // The demo button appears only where the sample answers are available and this copy is editable.
  $("fill-sample").hidden = !(CONFIG.IS_DEMO && CONFIG.SAMPLE_DATA) || state.readOnly;
  wireButtons();
  page.onRender(() => show(state.mode));
}

main().catch((err) => console.error("The application form could not start", err));
