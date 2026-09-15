// scope: shared
// The 11-step application form: one step per screen, big tap answers, automatic saving and the
// all-steps overview. The server checks every answer; the same shared rules run here for progress.
// Uses the SC_* shared scripts loaded by application.html.
import { startPage, showMessage, goTo, PAGES } from "../page.js";
import { createFormView } from "../form-view.js";
import { createAutosave } from "../autosave.js";
import { renderQuestion } from "../form-render.js";

const { SC_FormSchema, SC_FormRules, SC_Dates } = window;
const view = createFormView({ schema: SC_FormSchema, rules: SC_FormRules, dates: SC_Dates });
const $ = (id) => document.getElementById(id);
const EDITABLE = ["DRAFT", "RETURNED"];
const TEXT_TYPES = ["text", "textarea", "phone", "pincode", "number"];
// Typed answers that show or hide other questions on the same step.
const SHOW_IF_SOURCES = new Set(SC_FormSchema.allFields().filter((f) => f.showIf && f.showIf.field).map((f) => f.showIf.field));

const state = { page: null, app: null, values: {}, errors: {}, step: "s1", mode: "step", readOnly: false, autosave: null, status: null };
// Reloading after a clash is the fix the message asks for, so leaving is meant and not warned about.
let leavingOnPurpose = false;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const lang = () => state.page.prefs().lang;

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
  const type = SC_FormSchema.fieldById(fieldId).type;
  if (redraw && (!TEXT_TYPES.includes(type) || SHOW_IF_SOURCES.has(fieldId))) scheduleRedraw();
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
  $("next-btn").textContent = t(model.number === model.total ? "form.finish" : "form.saveNext");
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

function wireButtons() {
  const stepAt = (offset) => view.stepIds[view.stepIds.indexOf(state.step) + offset];
  $("next-btn").addEventListener("click", () => saveThen(() => (stepAt(1) ? show("step", stepAt(1)) : show("overview"))));
  $("back-btn").addEventListener("click", () => saveThen(() => (stepAt(-1) ? show("step", stepAt(-1)) : goTo(PAGES.home))));
  $("overview-btn").addEventListener("click", () => saveThen(() => show("overview")));
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
  state.autosave = createAutosave({ diff: view.changedValues, save: saveAnswers, onStatus: showStatus });
  state.autosave.start({ values: state.values, version: loaded.app.version });
  wireButtons();
  page.onRender(() => show(state.mode));
}

main().catch((err) => console.error("The application form could not start", err));
