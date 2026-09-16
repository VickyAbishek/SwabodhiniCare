// scope: shared
// The Director's decision (main spec §5, §10.1): the screen where the school's final decision is
// signed. Admit or Waitlist, the registration number that will be issued, the signature that goes on
// the report, their password again as the step-up, and what signing does — the lock. The mockup's S7
// sets the order out; D1 is what follows. Only these two moves are signed here: sending back and
// rejecting are the review screen's, which this screen links to rather than repeats.
import { startPage, showMessage, setBusy, fieldError, goTo, PAGES } from "../page.js";
import { deriveKey } from "../kdf.js";
import { createConfirmSheet } from "../confirm-sheet.js";
import { createRegPreview } from "../reg-preview.js";
import { joinNames } from "../i18n.js";

const { SC_Workflow, SC_Numbers } = window;
const $ = (id) => document.getElementById(id);
// What this screen signs, in the order the workflow offers them, and what each one says: the choice's
// own label, the button in the action bar, the question the confirmation asks, the consequence read
// back in the sheet, and the sentence the confirmation afterwards opens with.
const DECISIONS = Object.freeze({
  ADMIT: {
    label: "action.admit", sign: "action.signAndAdmit", title: "confirm.decideTitle",
    body: "decide.lockNote", done: "decide.admitted", number: true,
  },
  WAITLIST: {
    label: "action.waitlist", sign: "action.signAndWaitlist", title: "confirm.decideWaitlistTitle",
    body: "", done: "decide.waitlisted", number: false,
  },
});
// The review screen's moves. A file waiting on the Director may also be sent back or rejected, and
// neither of those is a signature, so neither happens here: the form links to that screen instead.
const REVIEW_ACTIONS = Object.freeze(["APPROVE", "SEND_BACK", "REJECT"]);

const state = { page: null, me: null, app: null, sheet: null, regPreview: null, number: null, keptNumber: false, actions: [], choice: null, decided: null };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const locale = () => (state.page.prefs().lang === "en" ? "en-IN" : "ta-IN");
const dayOf = (date) => date.toLocaleDateString(locale(), { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
// "15 Sept 2026, 10:52" — D1 prints a moment, not a day, so the {date} in decide.signedBy carries the
// time: "signed by you" without one says nothing about when the decision was made.
const stampOf = (iso) => new Date(iso).toLocaleString(locale(), {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

// What the workflow is told about this person to decide what they may do with this file. This round's
// separation of duties is not asked here: applications.get carries the approvals, but reading them
// into this rule would be the third copy of it (Applications.gs has one, the review screen another),
// and the case it settles — one person holding two reviewing roles — is latent. Such a person signs
// and hears ALREADY_APPROVED_STAGE from the server, which is the designed fallback and reads in both
// languages. What is asked here is what this stage offers this person at all, so the screen never
// draws a password box that could only be refused.
function ctx() {
  return { actorId: state.me.id, actorRoles: state.me.roles, createdBy: state.app.createdBy, approvedThisRound: [] };
}

/* Who can see the decision, as far as this screen can honestly say (D1's sentence): the people whose
   decisions are on this file's slip, by name, without the Director themself — "Signed by you" is the
   line above. The therapist who filled it in and the Admin see it too, and neither can be named here:
   applications.get carries the owner's id rather than their name, and the staff list is the Admin's to
   read. When nobody is left to name, the sentence uses the Admin's role, which is true of every file. */
function seenByNames() {
  const names = [];
  (state.app.approvals || []).forEach((row) => {
    if (row.userId !== state.me.id && row.userName && names.indexOf(row.userName) === -1) names.push(row.userName);
  });
  return names.length > 0 ? joinNames(names, state.page.t) : state.page.t("role.ADMIN");
}

function choiceButton(action) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "choice";
  node.dataset.action = action;
  node.setAttribute("aria-pressed", String(action === state.choice));
  node.textContent = state.page.t(DECISIONS[action].label);
  node.addEventListener("click", () => select(action));
  return node;
}

// The number field, when signing would issue one: the part that is already decided comes from
// js/reg-preview.js, and the hint beside it says where the rest comes from. A file that already holds
// a number shows it as itself rather than as a preview. Waitlisting issues none (decision #4), so with
// Waitlist chosen the field is left out — it is about what signing does, and signing mints nothing.
function drawNumber() {
  const spec = DECISIONS[state.choice];
  const preview = state.number;
  $("regno-field").hidden = !spec.number || !preview;
  if ($("regno-field").hidden) return;
  $("regno-label").textContent = state.page.t(preview.labelKey);
  $("regno").textContent = preview.value;
  $("regno-hint").textContent = preview.hintKey ? state.page.t(preview.hintKey) : "";
  $("regno-hint").hidden = !preview.hintKey;
}

// One choice at a time, redrawn in place so the keyboard keeps the button it was on.
function select(action) {
  state.choice = action;
  Array.from($("choices").children).forEach((node) => {
    node.setAttribute("aria-pressed", String(node.dataset.action === action));
  });
  drawNumber();
  $("sign").textContent = state.page.t(DECISIONS[action].sign);
}

// Drawn in code, so a language change redraws the choices, the number and the signature line with it.
// What the person has typed in the password box is in the markup and survives.
function draw() {
  if (!state.page || !state.app) return;
  if (state.decided) return drawDone();
  const { app, me } = state;
  const t = state.page.t;
  $("loading").hidden = true;

  $("applicant").textContent = app.applicantName || t("form.untitled");
  $("app-no").textContent = app.appNo;
  $("signer").textContent = `${me.name} · ${t("role.DIRECTOR")}`;
  $("sign-date").textContent = dayOf(new Date());
  const back = `application.html?id=${encodeURIComponent(app.id)}`;
  $("back").href = back;
  $("back-btn").href = back;
  $("review-instead").href = `review.html?id=${encodeURIComponent(app.id)}`;

  // Only the moves the workflow allows this person at this stage, in its own order, and nothing at
  // all when it allows none: then the screen is a sentence saying so rather than a form.
  const offered = SC_Workflow.availableActions(app.status, ctx());
  state.actions = offered.filter((action) => DECISIONS[action]);
  if (state.actions.length === 0) {
    $("decision-body").hidden = true;
    $("action-bar").hidden = true;
    showMessage($("message"), state.page.errorMessage({ code: "NOT_ALLOWED" }));
    return;
  }
  if (state.actions.indexOf(state.choice) === -1) state.choice = state.actions[0];

  $("decision-body").hidden = false;
  $("action-bar").hidden = false;
  $("choices").replaceChildren(...state.actions.map(choiceButton));
  // The two moves this screen does not sign are offered there, so the way to them is shown only when
  // the workflow would let this person take one: a waitlisted file has no such move, and no link.
  $("review-instead").hidden = !offered.some((action) => REVIEW_ACTIONS.includes(action));
  drawNumber();
  $("sign").textContent = t(DECISIONS[state.choice].sign);
}

// D1, in the Director's own language: what was decided, the number the server issued, who signed and
// when, and what signing did. The statuses come from the server's answer, not from the choice, so the
// sentence cannot disagree with the decision that was actually recorded.
function drawDone() {
  const t = state.page.t;
  const decided = state.decided;
  const admitted = decided.status === "ADMITTED";
  showMessage($("message"), ""); // a refusal from an earlier try has no business on this screen
  $("done-title").textContent = t(DECISIONS[admitted ? "ADMIT" : "WAITLIST"].done, {
    name: decided.applicantName || t("form.untitled"),
  });
  // Whatever the server issued, and only what it issued: a preview never reaches this line.
  $("done-regno").textContent = decided.registrationNo || "";
  $("done-regno-field").hidden = !decided.registrationNo;
  // A number the file already carried is not issued again (decision #5), so when the one above is
  // that number the screen says so. Two signings reach here: a reopened file signed a second time,
  // which keeps its number, and a waitlisted one — which is never issued a number at all — showing
  // the one it was given when it was admitted, the only path where a waitlist carries a number.
  const kept = Boolean(decided.registrationNo && state.keptNumber);
  $("done-regno-note").hidden = !kept;
  $("done-signed").textContent = t("decide.signedBy", { date: stampOf(decided.decidedAt) });
  // A waitlisted application is read-only but is not called locked (decision #4), and only an
  // admitted one is: so the sentence about who can see the decision is said for an admit alone.
  const locked = admitted ? t("decide.locked", { names: seenByNames() }) : "";
  $("done-lock").textContent = locked;
  $("done-lock").hidden = !locked;
}

function askToSign() {
  const t = state.page.t;
  if (!$("password").value) {
    fieldError("password", t("signin.passwordMissing"));
    $("password").focus();
    return;
  }
  fieldError("password", "");
  showMessage($("message"), ""); // trying again clears what the last attempt was told
  const spec = DECISIONS[state.choice];
  state.sheet.open({
    title: t(spec.title),
    body: spec.body ? t(spec.body) : "",
    yes: t("confirm.yesSign"),
    yesClass: "btn-primary",
    onYes: sign,
  }, $("sign"));
}

function fail(result) {
  state.sheet.close();
  showMessage($("message"), state.page.errorMessage(result.error));
  $("message").scrollIntoView({ block: "nearest" });
  $("password").focus();
}

async function sign() {
  const page = state.page;
  setBusy($("confirm-yes"), page.t("common.working"), true);
  try {
    // The step-up (main spec §10.1), the same shape the sign-in and password screens use: prelogin
    // gives this person's salt and round count, the phone derives the key, the server checks it. The
    // password itself never leaves the phone — and it is cleared below, so it does not stay on it
    // either, whether the decision went through or not.
    const pre = await page.api.call("auth.prelogin", { email: state.me.email });
    if (!pre.ok) {
      fail(pre);
      return;
    }
    const key = await deriveKey($("password").value, pre.data.salt, pre.data.iterations);
    const result = await page.api.call("applications.decide", {
      id: state.app.id, action: state.choice, comment: "", key,
    });
    if (!result.ok) {
      fail(result);
      return;
    }
    state.decided = result.data;
    state.sheet.close();
    $("decision-body").hidden = true;
    $("action-bar").hidden = true;
    $("back").hidden = true;
    $("done-body").hidden = false;
    drawDone();
    window.scrollTo({ top: 0 });
    $("done-body").focus(); // the confirmation replaces the form: it is what should be read next
  } catch (err) {
    console.error("The decision could not be sent", err);
    fail({ error: { code: "NETWORK_ERROR" } });
  } finally {
    setBusy($("confirm-yes"), "", false);
    $("password").value = ""; // there is no reason for a signature to stay typed in the page
  }
}

function wire() {
  state.sheet.wire();
  $("sign").addEventListener("click", askToSign);
  // The fields sit in a form, as the sign-in and password screens do, so the password manager knows
  // what it is looking at and Enter after typing signs: the confirmation still comes first, and the
  // form itself is never submitted anywhere.
  $("decision-form").addEventListener("submit", (event) => {
    event.preventDefault();
    askToSign();
  });
  // Typing clears the complaint, as the form's own fields do; the next try checks afresh.
  $("password").addEventListener("input", () => fieldError("password", ""));
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
  state.sheet = createConfirmSheet();
  state.regPreview = createRegPreview({ numbers: SC_Numbers, today });

  const id = new URL(window.location.href).searchParams.get("id");
  const result = id ? await page.api.call("applications.get", { id }) : { ok: false, error: { code: "NOT_FOUND" } };
  if (!result.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(result.error));
    return;
  }
  state.app = result.data;
  state.number = state.regPreview.show(state.app); // null when there is no honest preview to show
  // Whether this file arrived here with a number already, which is what tells D1 below whether the
  // number it shows was minted by this signing or kept from before it.
  state.keptNumber = Boolean(state.app.registrationNo);
  wire();
  page.onRender(draw); // drawn in code, so a language change redraws the whole form
}

main().catch((err) => console.error("The decision screen could not start", err));
