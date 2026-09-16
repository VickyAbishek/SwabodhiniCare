// scope: shared
// The 11-step application form: one step per screen, big tap answers, automatic saving and the
// all-steps overview. The server checks every answer; the same shared rules run here for progress.
// A file opens with a banner saying where it stands and, when a decision left a reason behind — sent
// back, reopened, rejected — who took it and what they said (main spec §5). A file that was sent back
// adds the sections still to fix and, in place of Save & Next, the button that sends it to the Therapy
// Head again. A draft or a file sent back can also be withdrawn from here and an admitted one
// reopened, each offered only to the people the workflow would let take it (main spec §5).
// Uses the SC_* shared scripts loaded by application.html.
import { startPage, showMessage, setBusy, goTo, PAGES } from "../page.js";
import { CONFIG } from "../config.js";
import { createFormView } from "../form-view.js";
import { createAutosave, saveStatusKey } from "../autosave.js";
import { createConfirmSheet } from "../confirm-sheet.js";
import { renderQuestion } from "../form-render.js";
import { isBlank, trimToInk, fitTo } from "../signature-pad.js";
import { compress, blobToBase64 } from "../image-compress.js";
import { joinNames } from "../i18n.js";

const { SC_FormSchema, SC_FormRules, SC_Dates, SC_Workflow } = window;
const view = createFormView({ schema: SC_FormSchema, rules: SC_FormRules, dates: SC_Dates });
const $ = (id) => document.getElementById(id);
const EDITABLE = ["DRAFT", "RETURNED"];
const TEXT_TYPES = ["text", "textarea", "phone", "pincode", "number"];
// The decisions that leave a reason on the slip: a file is RETURNED because a reviewer sent it back or
// the Director reopened it, and REJECTED because one rejected it. The banner shows the last of them —
// what the family has to answer now — and an earlier round's reason stays on the routing slip.
const REASON_ACTIONS = ["SEND_BACK", "REOPEN", "REJECT"];
// Typed answers that show or hide other questions on the same step.
const SHOW_IF_SOURCES = new Set(SC_FormSchema.allFields().filter((f) => f.showIf && f.showIf.field).map((f) => f.showIf.field));

const state = {
  page: null, me: null, app: null, values: {}, errors: {}, step: "s1", mode: "step",
  readOnly: false, resend: false, banner: null, autosave: null, sheet: null, status: null,
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

   It is drawn for every status a draft is not: a file with a reviewer, a rejected one, a settled one.
   The stamp says where the file stands, which is the one thing a therapist opening a file that has
   left her hands cannot otherwise see, and a rejection's reason is written down nowhere else she can
   reach. `returned` is the only one of those states that is also work, and it is what the "Steps to
   fix" list and the resend button hang off.

   `by` is the last send-back, reopen or rejection, the decision the family has to answer now; an
   earlier round's reason stays on the routing slip, which the review screen shows in full.
   `therapyHead` is the name this file's slip carries for the stage it is going back to — the person
   who last handled it there — because the staff list is the Admin's to read and nobody else can be
   looked up. */
function bannerInfo(app) {
  if (app.status === "DRAFT") return null;
  const rows = app.approvals || [];
  const head = rows.filter((row) => row.stage === "THERAPY_HEAD").pop();
  return {
    status: app.status,
    returned: app.status === "RETURNED",
    by: rows.filter((row) => REASON_ACTIONS.includes(row.action)).pop() || null,
    therapyHead: (head && head.userName) || "",
  };
}

// The role to name for the person on a slip row: the role the server recorded with the decision, which
// is the stage's own wherever they hold it, and their own role otherwise — an Admin's reopen is
// recorded at the DIRECTOR stage, and naming that stage would give them a job title they do not have.
function rowRole(row) {
  return `role.${row.role || row.stage}`;
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

// The banner above the questions: the status the file stands in and, when a decision left a reason,
// who took it and when, with their words in full. A draft has none of this — nothing has happened to
// it yet — and every other status has at least the stamp: a file waiting on a reviewer says so, and a
// rejected one carries the reason the family was never able to read before.
function renderBanner() {
  const { t } = state.page;
  const info = state.banner;
  $("status-banner").hidden = !info;
  if (!info) return;
  $("status-banner").dataset.status = info.status;
  $("banner-stamp").textContent = t(`status.${info.status}`);
  $("banner-stamp").dataset.status = info.status;
  const row = info.by;
  // The words are quoted with the person who gave them. A file with no such row — one waiting on its
  // first reviewer — says only what it can rather than naming a stage nobody has decided at.
  $("banner-by").textContent = row
    ? t("sentBack.by", { name: row.userName || t(rowRole(row)), role: t(rowRole(row)), date: shortDate(row.at) })
    : "";
  $("banner-by").hidden = !row;
  const comment = row ? row.comment || "" : "";
  $("banner-comment").textContent = comment;
  $("banner-comment").hidden = !comment;
  $("banner-words").hidden = !row && !comment;
  // Only a file that was sent back has work left on it, so only a returned file is told where to go
  // next and shown the sections to fix. Everything below this line belongs to that state alone.
  $("fix-title").hidden = !info.returned;
  $("resend-note").hidden = !info.returned;
  renderFixList();
}

/* "Steps to fix": the sections the form itself would still not accept, from the same completion rule
   the ticks and the overview read — never a list this screen made up. Both states that are not
   "done" belong here: a section nobody has started is as much work as one with answers missing.
   Nothing left to fix leaves the heading and the list out rather than showing an empty one. */
function renderFixList() {
  if (!state.banner || !state.banner.returned) return;
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

/* The two moves that are not part of filling the form in: withdrawing a file the family has dropped,
   and reopening one that was signed and needs a correction. Both are asked of the workflow — the same
   call Applications.gs makes — so a control is drawn only for the person the server would not refuse
   it to: the owner or an Admin on a draft or a file sent back, the Director or an Admin on an admitted
   one. Nobody else sees either, and no file is in both states at once. */
function renderFileActions() {
  const offered = SC_Workflow.availableActions(state.app.status, {
    actorId: state.me.id, actorRoles: state.me.roles, createdBy: state.app.createdBy,
  });
  const withdraw = offered.indexOf("WITHDRAW") !== -1;
  const reopen = offered.indexOf("REOPEN") !== -1;
  const id = encodeURIComponent(state.app.id);
  $("withdraw-btn").hidden = !withdraw;
  $("reopen-link").hidden = !reopen;
  $("file-actions").hidden = !withdraw && !reopen;
  if (reopen) $("reopen-link").href = `reopen.html?id=${id}`;
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

/* The pad's browser half: pointer events in, a PNG out. The geometry it leans on is in
   signature-pad.js, where a test can reach it.

   The parent signs with a finger, so touch-action: none on the canvas and preventDefault here
   both matter — without them the page scrolls under their hand instead of drawing. */
const SIGN_BOX = { width: 560, height: 180 };

function wireSignaturePad(field) {
  const { t } = state.page;
  const pad = $(`${field.id}-pad`);
  const state$ = $(`${field.id}-state`);
  if (!pad) return;
  const pen = pad.getContext("2d");
  let strokes = [];
  let drawing = false;

  // A lapsed signature says which fact moved, not merely that one did.
  const stale = staleConsentText();
  if (stale) {
    state$.textContent = stale;
    state$.classList.add("is-stale");
  }

  const paint = () => {
    pen.clearRect(0, 0, pad.width, pad.height);
    pen.lineWidth = 2.5;
    pen.lineCap = "round";
    pen.lineJoin = "round";
    pen.strokeStyle = "#111";
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      pen.beginPath();
      pen.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) pen.lineTo(point.x, point.y);
      pen.stroke();
    }
  };

  // The canvas is 600x200 but is laid out narrower on a phone, so a click at its right edge is
  // not at x=600. Scale from the box it actually occupies.
  const at = (event) => {
    const box = pad.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * (pad.width / box.width),
      y: (event.clientY - box.top) * (pad.height / box.height),
    };
  };

  if (state.readOnly) {
    pad.classList.add("is-readonly");
    return;
  }

  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drawing = true;
    pad.setPointerCapture(event.pointerId);
    strokes = strokes.concat([[at(event)]]);
  });
  pad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const last = strokes[strokes.length - 1];
    strokes = strokes.slice(0, -1).concat([last.concat([at(event)])]);
    paint();
  });
  const stop = () => { drawing = false; };
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointercancel", stop);

  $(`${field.id}-clear`).addEventListener("click", () => {
    strokes = [];
    paint();
    state$.textContent = "";
  });

  $(`${field.id}-save`).addEventListener("click", async () => {
    if (isBlank(strokes)) {
      state$.textContent = t("sign.blank");
      return;
    }
    state$.textContent = t("sign.saving");
    try {
      const result = await state.page.api.call("attachments.upload", {
        applicationId: state.app.id,
        kind: "CONSENT_SIGNATURE",
        filename: "signature.png",
        base64: signaturePng(strokes),
      });
      if (!result.ok) {
        state$.textContent = state.page.errorMessage(result.error);
        return;
      }
      // The answer holds the attachment id, so autosave carries it like any other answer.
      onAnswer(field.id, result.data.id, false);
      state$.classList.remove("is-stale");
      state$.textContent = t("sign.saved");
      const fresh = await state.page.api.call("applications.get", { id: state.app.id });
      if (fresh.ok) state.app = fresh.data;
      renderBanner();
    } catch (err) {
      console.error("The signature could not be uploaded", err);
      state$.textContent = t("sign.failed");
    }
  });
}

// Trimmed of its empty margin and scaled to one size, so every stored signature prints alike.
function signaturePng(strokes) {
  const fitted = fitTo(trimToInk(strokes, 0), SIGN_BOX);
  const out = document.createElement("canvas");
  out.width = SIGN_BOX.width + 16;
  out.height = SIGN_BOX.height + 16;
  const pen = out.getContext("2d");
  pen.lineWidth = 2.5;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  pen.strokeStyle = "#111";
  for (const stroke of fitted) {
    if (stroke.length < 2) continue;
    pen.beginPath();
    pen.moveTo(stroke[0].x + 8, stroke[0].y + 8);
    for (const point of stroke.slice(1)) pen.lineTo(point.x + 8, point.y + 8);
    pen.stroke();
  }
  return out.toDataURL("image/png").split(",")[1];
}

/* A file question's browser half: the pickers and the remove buttons, plus loading image bytes for
   thumbnails. The pure geometry is in image-compress.js; this owns the upload and the calls. */
function wireFileQuestion(field) {
  const makePicker = (accept, capture) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) uploadFile(field, file);
      input.value = "";
    });
    document.body.append(input);
    return input;
  };
  const accept = field.kind === "PHOTO" ? "image/*" : "image/*,application/pdf";
  const camera = $(`${field.id}-camera`);
  if (camera) camera.addEventListener("click", () => makePicker("image/*", true).click());
  const choose = $(`${field.id}-choose`);
  if (choose) choose.addEventListener("click", () => makePicker(accept, false).click());
  const ids = Array.isArray(field.value) ? field.value : [];
  ids.forEach((id) => {
    const remove = $(`${field.id}-remove-${id}`);
    if (remove) remove.addEventListener("click", () => removeFile(field, id));
    loadThumb(field, id);
  });
}

async function uploadFile(field, file) {
  const page = state.page;
  let blob = file;
  if (file.type.indexOf("image/") === 0) {
    try { blob = await compress(file, { maxDim: 1600, target: 300 * 1024 }); }
    catch (err) { console.error("The photo could not be compressed", err); }
  }
  const base64 = await blobToBase64(blob);
  const result = await page.api.call("attachments.upload", {
    applicationId: state.app.id, kind: field.kind, filename: file.name || "file", base64,
  });
  if (!result.ok) { showMessage($("message"), page.errorMessage(result.error)); return; }
  const current = Array.isArray(state.values[field.id]) ? state.values[field.id] : [];
  // Replacing (maxFiles 1) removes the old file explicitly, so it does not linger on the cap.
  if (field.maxFiles === 1 && current.length > 0) {
    await page.api.call("attachments.delete", { id: current[0] });
  }
  const next = field.maxFiles === 1 ? [result.data.id] : current.concat(result.data.id);
  const fresh = await page.api.call("applications.get", { id: state.app.id });
  if (fresh.ok) state.app = fresh.data;
  onAnswer(field.id, next, true);
}

async function removeFile(field, id) {
  const page = state.page;
  const result = await page.api.call("attachments.delete", { id });
  if (!result.ok) { showMessage($("message"), page.errorMessage(result.error)); return; }
  const next = (state.values[field.id] || []).filter((x) => x !== id);
  const fresh = await page.api.call("applications.get", { id: state.app.id });
  if (fresh.ok) state.app = fresh.data;
  onAnswer(field.id, next, true);
}

async function loadThumb(field, id) {
  const img = $(`${field.id}-thumb-${id}`);
  if (!img) return;
  const result = await state.page.api.call("attachments.get", { id });
  if (result.ok) img.src = `data:${result.data.mime};base64,${result.data.base64}`;
}

/* What to say when a signature no longer covers the answers. The server sends the list of facts
   that moved; naming them is the whole point. "Please sign again" with no reason is the defect
   closed in the rejection banner. */
function staleConsentText() {
  const { t } = state.page;
  const changed = (state.app && state.app.consentChanged) || [];
  if (!state.app || !state.app.consentStale || changed.length === 0) return "";
  const names = changed.map((id) => t(`sign.field.${id}`));
  return names.length === 1
    ? t("sign.changedOne", { field: names[0] })
    : t("sign.changedMany", { fields: joinNames(names, t) });
}

function renderStep() {
  const { t } = state.page;
  const model = view.stepModel(state.step, state.values, today(), lang());
  $("step-label").textContent = t("form.step", { n: model.number, total: model.total });
  $("step-title").textContent = model.title;
  $("app-no").textContent = state.app.appNo;
  renderTicks(model.number);
  const attachments = (state.app.attachments || []).reduce((map, a) => { map[a.id] = a; return map; }, {});
  const ctx = { t, today: today(), view, readOnly: state.readOnly, errorText, onAnswer, attachments };
  $("fields").replaceChildren(...model.fields.map((field) => renderQuestion(field, ctx)));
  model.fields.filter((f) => f.type === "signature").forEach(wireSignaturePad);
  model.fields.filter((f) => f.type === "file").forEach(wireFileQuestion);
  drawPrimary(model);
  renderBanner();
  renderFileActions();
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
  const key = saveStatusKey(status.state); // autosave.js owns the states, so it owns their wording
  box.dataset.state = status.state;
  box.textContent = key ? t(key, { time }) : "";
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
  const body = state.banner.therapyHead
    ? t("confirm.sendBody", { name: state.banner.therapyHead })
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

/* Withdrawing (main spec §5): the family has decided not to continue, so the therapist — or an Admin
   acting for them — marks the file withdrawn. Nothing is deleted: the record and its routing slip
   stay, which is what the shared sheet says before it is sent and what the sentence afterwards
   repeats. The screen's own sheet asks the question; this screen sends the answer. */
function askToWithdraw() {
  const { t } = state.page;
  state.sheet.open({
    title: t("withdraw.title"),
    body: t("withdraw.confirm"),
    yes: t("confirm.yesWithdraw"),
    yesClass: "btn-warn",
    onYes: withdraw,
  }, $("withdraw-btn"));
}

async function withdraw() {
  const page = state.page;
  setBusy($("confirm-yes"), page.t("common.working"), true);
  try {
    // What is on the screen goes to the server first, as it does before a resend: the file is still
    // editable until this moment, and an answer typed a moment ago belongs to it.
    const flushed = await state.autosave.flush();
    if (!flushed.ok) return refuseWithdraw(flushed);
    const result = await page.api.call("applications.withdraw", { id: state.app.id });
    if (!result.ok) return refuseWithdraw(result);
    // Out of this person's queue and out of the workflow. The screen stays where it is and says so,
    // read-only from here on: "nothing is deleted" is the one thing the family needs to be sure of,
    // and the answers still on the screen behind that sentence are what proves it.
    state.app = result.data;
    state.readOnly = true;
    state.resend = false;
    state.banner = bannerInfo(state.app);
    state.sheet.close();
    show(state.mode);
    showMessage($("message"), page.t("withdraw.done"), "ok");
  } catch (err) {
    console.error("The application could not be withdrawn", err);
    refuseWithdraw({ error: { code: "NETWORK_ERROR" } });
  } finally {
    setBusy($("confirm-yes"), "", false);
  }
}

function refuseWithdraw(result) {
  state.sheet.close();
  showMessage($("message"), state.page.errorMessage(result.error));
  $("message").scrollIntoView({ block: "start" });
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
  $("withdraw-btn").addEventListener("click", askToWithdraw);
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
  state.me = me.data;
  state.app = loaded.app;
  state.values = Object.assign({}, loaded.app.values);
  state.step = loaded.step;
  state.mode = loaded.mode;
  state.readOnly = loaded.app.createdBy !== me.data.id || !EDITABLE.includes(loaded.app.status);
  state.banner = bannerInfo(loaded.app);
  // Only the file's own therapist sends it again: anyone else reading a returned file sees the
  // reason, and nothing on the screen pretends they could act on it.
  state.resend = Boolean(state.banner && state.banner.returned) && !state.readOnly;
  state.autosave = createAutosave({ diff: view.changedValues, save: saveAnswers, onStatus: showStatus });
  state.autosave.start({ values: state.values, version: loaded.app.version });
  state.sheet = createConfirmSheet();
  // The demo button appears only where the sample answers are available and this copy is editable.
  $("fill-sample").hidden = !(CONFIG.IS_DEMO && CONFIG.SAMPLE_DATA) || state.readOnly;
  wireButtons();
  page.onRender(() => show(state.mode));
}

main().catch((err) => console.error("The application form could not start", err));
