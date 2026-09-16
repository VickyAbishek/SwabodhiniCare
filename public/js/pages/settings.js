// scope: shared
// Settings (screen S13): language and light/dark, saved to the account (me.update) and on this
// phone, plus account details, change password and sign out. Light stays the default (D23).
import { startPage, showMessage, goTo, PAGES } from "../page.js";
import { isBlank } from "../signature-pad.js";
import { strokesToPng } from "../signature-image.js";

async function saveToAccount(page, message, changes) {
  const result = await page.api.call("me.update", changes);
  showMessage(message, result.ok ? "" : page.errorMessage(result.error));
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const message = document.getElementById("message");
  const me = await page.api.call("me.get");
  if (!me.ok) {
    showMessage(message, page.errorMessage(me.error));
    return;
  }
  const user = me.data;
  page.setPrefs({ lang: user.preferredLang, theme: user.preferredTheme });
  page.onRender(() => {
    document.getElementById("fact-name").textContent = user.name;
    document.getElementById("fact-email").textContent = user.email;
    document.getElementById("fact-roles").textContent = user.roles.map((role) => page.t(`role.${role}`)).join(", ");
  });

  // The Director's stored signature (M7b spec §3.5). Shown only to the Director: the section is
  // hidden in the HTML and revealed here, so nobody else even sees the pad.
  if (user.roles.includes("DIRECTOR")) {
    document.getElementById("signature-section").hidden = false;
    const pad = document.getElementById("director-pad");
    const stateEl = document.getElementById("director-state");
    const pen = pad.getContext("2d");
    let strokes = [];
    let drawing = false;

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
    const at = (event) => {
      const box = pad.getBoundingClientRect();
      return { x: (event.clientX - box.left) * (pad.width / box.width), y: (event.clientY - box.top) * (pad.height / box.height) };
    };
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
    pad.addEventListener("pointerup", () => { drawing = false; });
    pad.addEventListener("pointercancel", () => { drawing = false; });

    document.getElementById("director-clear").addEventListener("click", () => {
      strokes = [];
      paint();
      stateEl.textContent = "";
    });
    document.getElementById("director-save").addEventListener("click", async () => {
      if (isBlank(strokes)) { stateEl.textContent = page.t("sign.blank"); return; }
      stateEl.textContent = page.t("sign.saving");
      const result = await page.api.call("signature.upload", { base64: strokesToPng(strokes) });
      if (!result.ok) { stateEl.textContent = page.errorMessage(result.error); return; }
      stateEl.textContent = page.t("sign.saved");
    });
    // A stored signature shows as "Signed ✓", fetched once when Settings opens.
    page.api.call("signature.get", {}).then((got) => {
      if (got.ok && got.data.base64) stateEl.textContent = page.t("sign.saved");
    });
  }

  // page.js already switches the screen; these also save the choice to the account.
  document.querySelectorAll("[data-set-lang]").forEach((button) => {
    button.addEventListener("click", () => saveToAccount(page, message, { preferredLang: button.dataset.setLang }));
  });
  document.querySelectorAll("[data-set-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      page.setPrefs({ theme: button.dataset.setTheme });
      saveToAccount(page, message, { preferredTheme: button.dataset.setTheme });
    });
  });

  document.getElementById("sign-out").addEventListener("click", async () => {
    await page.api.call("auth.logout");
    goTo(PAGES.signIn);
  });
}

main().catch((err) => console.error("The settings screen could not start", err));
