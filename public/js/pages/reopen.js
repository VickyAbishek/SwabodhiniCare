// scope: shared
// Reopening a signed application (main spec §5): an admitted file that turns out to need a correction
// goes back to the therapist with the reason it was reopened. The Director or the Admin, and the
// reason is required — a file that leaves a locked stage has to say why. The registration number is
// deliberately left alone: it was issued once and the family keeps it, so this screen says so out
// loud rather than looking as though reopening might mint another.
//
// No mockup exists for this screen (the mockups' own list leaves reopen and withdraw to be drawn), so
// it reuses the review screen's shell and the shared confirmation sheet.
import { startPage, showMessage, setBusy, fieldError, goTo, PAGES } from "../page.js";
import { createConfirmSheet } from "../confirm-sheet.js";

const { SC_Workflow } = window;
const $ = (id) => document.getElementById(id);

const state = { page: null, me: null, app: null, sheet: null, reopened: null };

// What the workflow is told about this person and this file, so the screen never draws a form the
// server would refuse: the same call Applications.gs makes, with the reason the box holds.
function ctx(reason) {
  return { actorId: state.me.id, actorRoles: state.me.roles, createdBy: state.app.createdBy, comment: reason };
}

// Drawn in code, so a language change redraws the heading, the note and the button with it while
// whatever the person has typed in the reason box stays where it is.
function draw() {
  if (!state.page || !state.app) return;
  if (state.reopened) return drawDone();
  const { app } = state;
  const t = state.page.t;
  $("loading").hidden = true;

  $("applicant").textContent = app.applicantName || t("form.untitled");
  $("app-no").textContent = app.appNo;
  const back = `application.html?id=${encodeURIComponent(app.id)}`;
  $("back").href = back;
  $("back-btn").href = back;

  // Only the people the workflow would let reopen this file get a reason box at all; anybody else is
  // told plainly that this is not theirs to do, rather than being invited to write and be refused.
  // (An Admin would be offered it too — the workflow's rule, not a role list written out again here.)
  if (SC_Workflow.availableActions(app.status, ctx("")).indexOf("REOPEN") === -1) {
    $("reopen-body").hidden = true;
    $("action-bar").hidden = true;
    showMessage($("message"), state.page.errorMessage({ code: "NOT_ALLOWED" }));
    return;
  }
  $("reopen-body").hidden = false;
  $("action-bar").hidden = false;
  $("reopen").textContent = t("action.reopen");
}

// The reason is required, so the screen checks the box itself before anything is sent (main spec §12)
// — the server checks it too, and a refusal from there lands on the same field.
function askToReopen() {
  const t = state.page.t;
  const reason = $("reason").value.trim();
  const move = SC_Workflow.next(state.app.status, "REOPEN", ctx(reason));
  if (!move.ok) {
    fieldError("reason", move.error === "COMMENT_REQUIRED" ? t("reopen.reasonMissing") : state.page.errorMessage({ code: move.error }));
    $("reason").focus();
    return;
  }
  fieldError("reason", "");
  showMessage($("message"), ""); // trying again clears what the last attempt was told
  state.sheet.open({
    title: t("confirm.reopenTitle"),
    commentLabel: t("reopen.reason"),
    comment: reason,
    body: t("confirm.reopenBody"),
    yes: t("confirm.yesReopen"),
    yesClass: "btn-primary",
    onYes: reopen,
  }, $("reopen"));
}

function fail(result) {
  state.sheet.close();
  showMessage($("message"), state.page.errorMessage(result.error));
  $("message").scrollIntoView({ block: "nearest" });
  $("reason").focus();
}

async function reopen() {
  const page = state.page;
  setBusy($("confirm-yes"), page.t("common.working"), true);
  try {
    const result = await page.api.call("applications.reopen", {
      id: state.app.id, reason: $("reason").value.trim(),
    });
    if (!result.ok) {
      fail(result);
      return;
    }
    state.reopened = result.data;
    state.sheet.close();
    $("reopen-body").hidden = true;
    $("action-bar").hidden = true;
    $("back").hidden = true;
    $("done-body").hidden = false;
    drawDone();
    window.scrollTo({ top: 0 });
    $("done-body").focus(); // the confirmation replaces the form: it is what should be read next
  } catch (err) {
    console.error("The application could not be reopened", err);
    fail({ error: { code: "NETWORK_ERROR" } });
  } finally {
    setBusy($("confirm-yes"), "", false);
  }
}

// Where the file went and what it kept, read off the server's own answer rather than off the status
// the screen expected: the number shown is the one the file already had, never a new one.
function drawDone() {
  const t = state.page.t;
  const reopened = state.reopened;
  showMessage($("message"), ""); // a refusal from an earlier try has no business on this screen
  $("done-title").textContent = t("reopen.done", { name: reopened.applicantName || t("form.untitled") });
  $("done-stamp").textContent = t(`status.${reopened.status}`);
  $("done-stamp").dataset.status = reopened.status;
  $("done-regno").textContent = reopened.registrationNo || "";
  $("done-regno-field").hidden = !reopened.registrationNo;
}

function wire() {
  state.sheet.wire();
  $("reopen").addEventListener("click", askToReopen);
  // The reason sits in a form, as the review screen's comment box does, so Enter after typing reaches
  // the confirmation; the form itself is never submitted anywhere.
  $("reopen-form").addEventListener("submit", (event) => {
    event.preventDefault();
    askToReopen();
  });
  // Typing clears the complaint, as the form's own fields do; the next try checks afresh.
  $("reason").addEventListener("input", () => fieldError("reason", ""));
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

  const id = new URL(window.location.href).searchParams.get("id");
  const result = id ? await page.api.call("applications.get", { id }) : { ok: false, error: { code: "NOT_FOUND" } };
  if (!result.ok) {
    $("loading").hidden = true;
    showMessage($("message"), page.errorMessage(result.error));
    return;
  }
  state.app = result.data;
  wire();
  page.onRender(draw); // drawn in code, so a language change redraws the whole form
}

main().catch((err) => console.error("The reopen screen could not start", err));
