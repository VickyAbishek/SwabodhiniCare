// scope: shared
// The confirmation sheet every decision passes through (main spec §12): a question in plain words
// over a dimmed screen, the person's own comment read back to them, a Yes carrying the tone of what
// it does, and a No that goes back. The review screen and the Director's decision screen both use
// it, because the behaviour below is only worth getting right once: focus moves into the sheet, Tab
// stays inside it, Escape and the dimmed backdrop close it, focus returns to the button that opened
// it, and a second tap on Yes does nothing while the first is still in flight.
//
// The screen owns the wording and the work. It passes text already resolved through page.t() and an
// onYes that sends the action, and keeps whatever it needs in its own closure.
const $ = (id) => document.getElementById(id);

export function createConfirmSheet() {
  let onYes = null;
  let opener = null;
  let sending = false;

  // spec: { title, commentLabel, comment, body, yes, yesClass, onYes }. opener is the button to
  // hand focus back to when the sheet closes, if it is still on the screen.
  function open(spec, openerNode) {
    onYes = spec.onYes;
    opener = openerNode || null;
    sending = false;
    $("confirm-title").textContent = spec.title;
    $("confirm-comment-label").textContent = spec.commentLabel || "";
    $("confirm-comment-label").hidden = !spec.comment;
    $("confirm-comment").textContent = spec.comment || "";
    $("confirm-comment").hidden = !spec.comment;
    $("confirm-body").textContent = spec.body || "";
    $("confirm-body").hidden = !spec.body;
    $("confirm-yes").textContent = spec.yes;
    $("confirm-yes").className = `btn ${spec.yesClass || "btn-ok"}`;
    $("confirm").hidden = false;
    $("confirm-yes").focus();
  }

  function close() {
    onYes = null;
    $("confirm").hidden = true;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  // Called once, at start-up, by each screen that carries the sheet in its markup.
  function wire() {
    $("confirm-no").addEventListener("click", close);
    $("confirm-yes").addEventListener("click", () => {
      // One decision per sheet: the tap that already sent it is the answer, and a second one —
      // an unsteady hand, or a slow answer from the server — sends nothing more.
      if (!onYes || sending) return;
      sending = true;
      onYes();
    });
    $("confirm").addEventListener("click", (event) => {
      if (event.target === $("confirm")) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("confirm").hidden) close();
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

  return Object.freeze({ open, close, wire });
}
