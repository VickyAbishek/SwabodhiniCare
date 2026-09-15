// scope: shared
// The review screen (main spec §5, §12): a Therapy Head, Centre Head or Director reads one
// application — the applicant, the key facts, the safety flags and the routing slip — writes what
// they think of it, and approves, sends it back or rejects it. The buttons come from the workflow
// itself, so nobody is offered a move the server would refuse, and every one of them is confirmed in
// plain words before it is sent.
import { startPage, showMessage, setBusy, goTo, PAGES } from "../page.js";
import { createRoutingSlip } from "../routing-slip.js";

const { SC_Workflow, SC_Dates, SC_FormSchema } = window;
const $ = (id) => document.getElementById(id);

// What this screen may do with a file, and how each action is worded, coloured and confirmed. ADMIT
// and WAITLIST belong to the Director's decision screen, REOPEN and WITHDRAW to the reopen and
// withdraw screens, so a Director who could reopen an admitted file is offered nothing here.
const ACTIONS = Object.freeze({
  APPROVE: { label: "action.approve", button: "btn-ok", title: "confirm.approveTitle", yes: "confirm.yesApprove" },
  SEND_BACK: { label: "action.sendBack", button: "btn-warn", title: "confirm.sendBackTitle", body: "confirm.sendBackBody", yes: "confirm.yesSendBack" },
  REJECT: { label: "action.reject", button: "btn-bad", title: "confirm.rejectTitle", body: "confirm.rejectBody", yes: "confirm.yesReject" },
});
// The approve confirmation names who decides next, and each destination has a wording of its own
// rather than a role glued into one sentence: Tamil writes the role into the sentence with an ending
// that changes with the noun, so the glued form would be ungrammatical there. Keyed by the status
// the workflow says the file moves to, so a change to the route shows up as a missing wording rather
// than as a sentence naming the wrong person.
const APPROVE_TITLES = Object.freeze({
  PENDING_CENTRE_HEAD: "confirm.approveToCentreHead",
  PENDING_DIRECTOR: "confirm.approveTitle",
});
const SUITABILITY_TONE = { SUITABLE: "stamp-ok", NEEDS_ASSESSMENT: "stamp-warn", NOT_SUITABLE: "stamp-bad" };

const state = { page: null, me: null, app: null, slip: null, actions: [], pending: null, opener: null };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const lang = () => state.page.prefs().lang;
const shortDate = (iso) => new Date(iso).toLocaleDateString(lang() === "en" ? "en-IN" : "ta-IN", { day: "numeric", month: "short" });

function span(className, text) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/* Who has already approved this round — one person may not approve two stages of the same
   application, which is what matters for anybody holding two reviewing roles. The browser's twin of
   approversThisRound in poc/apps-script/Applications.gs, and the two must stay in step: the rule is
   written twice only because applications.get does not carry the answer ready-made. It is the ids on
   the Approvals rows whose action approves (APPROVE or ADMIT — a WAITLIST is not an approval, or a
   Director who waitlisted could never admit later) and whose time is at or after submittedAt. Each
   SUBMIT re-stamps submittedAt, so a send-back and resend clears the round by itself. */
function approversThisRound() {
  const submittedAt = state.app.submittedAt;
  return (state.app.approvals || [])
    .filter((row) => (row.action === "APPROVE" || row.action === "ADMIT") && (!submittedAt || row.at >= submittedAt))
    .map((row) => row.userId);
}

// The context SC_Workflow checks an action against, from what this screen knows: the person signed in,
// the file's author and who has already approved this round — so a button this person would be
// refused is not drawn at all, and the refusal reads out from the server if it slips through anyway.
function ctx(comment, approvedThisRound = approversThisRound()) {
  return {
    actorId: state.me.id, actorRoles: state.me.roles, createdBy: state.app.createdBy,
    approvedThisRound, comment,
  };
}

// Why there is nothing to press on a file this person was counted as the reviewer for: because of
// the approvals already taken this round, the workflow would refuse them every action here — not
// only Approve, which the last statuses have no action for at all (PENDING_DIRECTOR and WAITLISTED
// offer ADMIT and WAITLIST instead). So the question is asked of the whole set, by asking the
// workflow what this person could do if this round's approvals were set aside: if that is not
// nothing, this round's rule is what is stopping them, and that is what the sentence says.
//
// A file nobody expects them to touch still says nothing — the stamp already names the stage holding
// it — and neither does the owner's own file or a stage that is not theirs: in those cases the
// workflow would refuse them with the round set aside too, so the sentence would be beside the point.
function blockedNote() {
  if (state.actions.length > 0) return "";
  const withoutRound = SC_Workflow.availableActions(state.app.status, ctx("", [])).filter((action) => ACTIONS[action]);
  return withoutRound.length > 0 ? state.page.errorMessage({ code: "ALREADY_APPROVED_STAGE" }) : "";
}

function optionLabel(list, value) {
  return value ? SC_FormSchema.optionLabel(list, value, lang()) || "" : "";
}

// "19 yrs · Male · Velachery", the line the queue card shows too, worked out from the date of birth
// every time it is drawn so it stays right while a file sits in the queue.
function subtitle() {
  const app = state.app;
  const values = app.values || {};
  const dob = values.s2_dob;
  let age = "";
  if (dob) {
    try {
      age = state.page.t("queue.ageYears", { n: SC_Dates.ageFrom(dob, today()).years });
    } catch (err) {
      age = ""; // a date that is not a real one: the line shows the rest of it without the age
    }
  }
  return [age, optionLabel("GENDER", values.s2_gender), optionLabel("CENTRE", app.centre)].filter(Boolean).join(" · ");
}

// The safety flags the form watches for. The row is always drawn: a safety line that is missing and
// one that is clear look the same to somebody reading quickly, and this is the line they must not
// have to wonder about.
function safetyValue() {
  const flags = (state.app.safetyFlags || []).map((id) => {
    const field = SC_FormSchema.fieldById(id);
    return field ? field[lang() === "en" ? "en" : "ta"] : id;
  });
  if (flags.length === 0) return span("", state.page.t("review.noSafety"));
  const wrap = document.createElement("div");
  wrap.className = "flags";
  flags.forEach((text) => wrap.append(span("flag", text)));
  return wrap;
}

function factRow(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.append(value);
  row.append(term, detail);
  return row;
}

// The four key facts the review screen opens with, as the mockup's S6 lays them out: what the
// diagnosis says, what the therapist thought, what they recommend, and what to watch for. A fact
// with no answer is left out rather than shown empty: the whole application is one tap below.
function facts() {
  const values = state.app.values || {};
  const t = state.page.t;
  const rows = [];
  const diagnosis = optionLabel("ASD", values.s4_asd_diagnosed);
  if (diagnosis) rows.push(factRow(t("review.diagnosis"), span("", diagnosis)));
  const suitability = optionLabel("SUITABILITY", values.s10_suitability);
  if (suitability) rows.push(factRow(t("review.view"), span(`stamp ${SUITABILITY_TONE[values.s10_suitability] || ""}`, suitability)));
  const recommended = (Array.isArray(values.s10_recommended_programs) ? values.s10_recommended_programs : [])
    .map((id) => optionLabel("PROGRAMS", id)).filter(Boolean).join(", ");
  if (recommended) rows.push(factRow(t("review.recommended"), span("", recommended)));
  rows.push(factRow(t("review.safety"), safetyValue()));
  return rows;
}

// The slip names the stages nobody has signed yet: the therapist who filled the form in (only if
// this is their own file — the staff list is not readable here), and "You" for the step the file is
// waiting on when that is the reader's own.
function slipNames() {
  const names = {};
  if (state.app.createdBy === state.me.id) names.THERAPIST = state.page.t("slip.you");
  const mine = SC_Workflow.reviewerRole(state.app.status);
  if (mine && state.me.roles.indexOf(mine) !== -1) names[mine] = state.page.t("slip.you");
  return names;
}

function slipList() {
  const t = state.page.t;
  const rows = state.slip.slip({
    status: state.app.status,
    approvals: state.app.approvals,
    names: slipNames(),
    submittedAt: state.app.submittedAt,
    // `applications.get` dates the file's creation, its submission and every decision, and nothing
    // else, so there is no "filled in with the parent" moment to pass. A submitted file shows the
    // day it was sent — what a reviewer wants — and this date is only reached for a file still being
    // filled in, where the day its record began is the closest thing the payload holds.
    filledInAt: state.app.createdAt,
  });
  return rows.map((row, index) => {
    const item = document.createElement("li");
    if (row.state === "done") item.className = "is-done";
    if (row.state === "now") item.className = "is-now";
    const body = document.createElement("div");
    body.className = "slip-body";
    body.append(span("slip-role", [t(`role.${row.stage}`), row.name].filter(Boolean).join(" · ")));
    body.append(span("slip-meta", row.meta));
    if (row.comment) {
      const note = document.createElement("p");
      note.className = "slip-note";
      note.textContent = row.comment;
      body.append(note);
    }
    const node = span("node", row.state === "done" ? "✓" : String(index + 1));
    node.setAttribute("aria-hidden", "true"); // the meta line already says where the step stands
    item.append(node, body);
    return item;
  });
}

// The wording of the confirmation. Approving names who decides next, which each destination words
// for itself; every other action uses the one title it has. Which of them applies comes from the
// workflow's own call, the one the server makes, so it cannot outlive a change to the route.
function titleKey(action) {
  const move = SC_Workflow.next(state.app.status, action, ctx($("comment").value.trim()));
  const to = move.ok ? APPROVE_TITLES[move.status] : null;
  return to || ACTIONS[action].title;
}

// The comment box's own error line. The hint stays attached to the field as well, so somebody who
// has cleared the error does not lose the sentence that says when a comment is needed.
function commentError(text) {
  const box = $("comment-error");
  box.textContent = text || "";
  box.hidden = !text;
  $("comment").setAttribute("aria-invalid", text ? "true" : "false");
  $("comment").setAttribute("aria-describedby", text ? "comment-hint comment-error" : "comment-hint");
}

function openSheet(action) {
  const spec = ACTIONS[action];
  const t = state.page.t;
  const comment = $("comment").value.trim();
  state.pending = action;
  $("confirm-title").textContent = t(titleKey(action));
  $("confirm-comment-label").textContent = t("review.comment");
  $("confirm-comment-label").hidden = !comment;
  $("confirm-comment").textContent = comment;
  $("confirm-comment").hidden = !comment;
  $("confirm-body").textContent = spec.body ? t(spec.body) : "";
  $("confirm-body").hidden = !spec.body;
  $("confirm-yes").textContent = t(spec.yes);
  $("confirm-yes").className = `btn ${spec.button}`;
  $("confirm").hidden = false;
  $("confirm-yes").focus();
}

function closeSheet() {
  state.pending = null;
  $("confirm").hidden = true;
  if (state.opener) state.opener.focus();
}

// The server refuses a send-back or a rejection without a comment, so the same rule is run here
// first, against the box itself, rather than letting the round-trip say so afterwards (main §12).
function ask(action, opener) {
  state.opener = opener;
  const move = SC_Workflow.next(state.app.status, action, ctx($("comment").value.trim()));
  if (!move.ok) {
    const text = state.page.errorMessage({ code: move.error });
    if (move.error === "COMMENT_REQUIRED") {
      commentError(text);
      $("comment").focus();
    } else {
      showMessage($("message"), text);
    }
    return;
  }
  commentError("");
  openSheet(action);
}

async function act(action, button) {
  const page = state.page;
  setBusy(button, page.t("common.working"), true);
  const result = await page.api.call("applications.review", {
    id: state.app.id, action, comment: $("comment").value.trim(),
  });
  if (result.ok) {
    // The decision is made and the file has left this person's stage: the queue is where they work.
    goTo(PAGES.home);
    return;
  }
  setBusy(button, "", false);
  closeSheet();
  showMessage($("message"), page.errorMessage(result.error));
  $("message").scrollIntoView({ block: "nearest" });
}

function button(action) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `btn ${ACTIONS[action].button}`;
  node.textContent = state.page.t(ACTIONS[action].label);
  node.addEventListener("click", () => ask(action, node));
  return node;
}

function wire() {
  // Answering the complaint clears it, as the form's own fields do; the next action checks afresh.
  $("comment").addEventListener("input", () => commentError(""));
  $("confirm-no").addEventListener("click", closeSheet);
  $("confirm-yes").addEventListener("click", () => {
    if (state.pending) act(state.pending, $("confirm-yes"));
  });
  $("confirm").addEventListener("click", (event) => {
    if (event.target === $("confirm")) closeSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("confirm").hidden) closeSheet();
  });
  // Tab stays inside the sheet while it is open: aria-modal tells assistive tech the rest of the
  // page is out of reach for the moment, so the keyboard has to agree.
  $("confirm").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [$("confirm-yes"), $("confirm-no")];
    const stop = event.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement !== stop) return;
    event.preventDefault();
    (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  });
}

// Drawn in code, so a language change redraws the facts, the slip and the buttons with it. What the
// person has typed in the comment box is in the markup and survives.
function draw() {
  const { app, me } = state;
  if (!app) return;
  const t = state.page.t;
  $("loading").hidden = true;
  $("review-body").hidden = false;

  $("applicant").textContent = app.applicantName || t("form.untitled");
  $("thumb").textContent = app.applicantName
    ? app.applicantName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("")
    : "";
  $("thumb").hidden = !app.applicantName;
  const sub = subtitle();
  $("applicant-sub").textContent = sub;
  $("applicant-sub").hidden = !sub;
  $("app-no").textContent = app.appNo;

  // Where the file is: this person's turn, or the stage holding it (the reader may be an Admin or
  // the Director, looking on).
  const mine = SC_Workflow.isMyTurn(app.status, { actorId: me.id, actorRoles: me.roles, createdBy: app.createdBy });
  $("stamp-row").replaceChildren(span(`stamp${mine ? " stamp-turn" : ""}`, t(mine ? "queue.yourTurn" : `status.${app.status}`)));

  $("facts").replaceChildren(...facts());
  $("read-full").href = `application.html?id=${encodeURIComponent(app.id)}&view=all`;
  $("slip").replaceChildren(...slipList());

  // In the order the workflow lists them, never a list of this screen's own.
  state.actions = SC_Workflow.availableActions(app.status, ctx("")).filter((action) => ACTIONS[action]);
  $("action-bar").replaceChildren(...state.actions.map(button));
  $("action-bar").hidden = state.actions.length === 0;
  $("comment-field").hidden = state.actions.length === 0;
  const blocked = blockedNote();
  $("blocked").textContent = blocked;
  $("blocked").hidden = !blocked;
}

async function load(page) {
  const id = new URL(window.location.href).searchParams.get("id");
  const result = id ? await page.api.call("applications.get", { id }) : { ok: false, error: { code: "NOT_FOUND" } };
  if (!result.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(result.error));
    return null;
  }
  return result.data;
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const me = await page.api.call("me.get");
  if (!me.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(me.error));
    return;
  }
  if (me.data.mustChangePassword) {
    goTo(PAGES.password);
    return;
  }
  // The account's saved choices win, so every phone looks the same for this person.
  page.setPrefs({ lang: me.data.preferredLang, theme: me.data.preferredTheme });
  state.page = page;
  state.me = me.data;
  state.slip = createRoutingSlip({ workflow: SC_Workflow, t: page.t, formatDate: shortDate });
  wire();
  const app = await load(page);
  if (!app) return;
  state.app = app;
  page.onRender(draw);
}

main().catch((err) => console.error("The review screen could not start", err));
