// scope: shared
// Choose your own password. Both the current and the new password become keys on the phone;
// the server checks the current key and stores the new one. Other devices are signed out.
import { startPage, showMessage, setBusy, fieldError, goTo, PAGES } from "../page.js";
import { CONFIG } from "../config.js";
import { deriveKey, newSalt, checkPassword } from "../kdf.js";

const SAVED_PAUSE_MS = 1200;

async function changePassword(page, email, current, next) {
  const pre = await page.api.call("auth.prelogin", { email });
  if (!pre.ok) return pre;
  const currentKey = await deriveKey(current, pre.data.salt, pre.data.iterations);
  const salt = newSalt();
  const newKey = await deriveKey(next, salt, CONFIG.KDF_ITERATIONS);
  return page.api.call("auth.changePassword", { currentKey, newSalt: salt, newKey });
}

function checkForm(page, current, next, again) {
  const problem = checkPassword(next);
  const problems = {
    current: current ? "" : page.t("signin.passwordMissing"),
    password: problem ? page.t(problem) : "",
    password2: next === again ? "" : page.t("password.mismatch"),
  };
  Object.entries(problems).forEach(([id, text]) => fieldError(id, text));
  return Object.values(problems).every((text) => !text);
}

function showIntro(page, temporary) {
  const intro = document.getElementById("intro");
  intro.dataset.i18n = temporary ? "password.introTemporary" : "password.intro";
  intro.textContent = page.t(intro.dataset.i18n);
  document.getElementById("back").hidden = temporary;
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const button = document.getElementById("submit");
  const message = document.getElementById("message");
  const me = await page.api.call("me.get");
  if (!me.ok) {
    showMessage(message, page.errorMessage(me.error));
    return;
  }
  showIntro(page, me.data.mustChangePassword);

  document.getElementById("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = (id) => document.getElementById(id).value;
    if (!checkForm(page, value("current"), value("password"), value("password2"))) return;
    showMessage(message, "");
    setBusy(button, page.t("password.working"), true);
    try {
      const result = await changePassword(page, me.data.email, value("current"), value("password"));
      if (!result.ok) {
        showMessage(message, page.errorMessage(result.error));
        return;
      }
      showMessage(message, page.t("password.saved"), "ok");
      setTimeout(() => goTo(PAGES.home), SAVED_PAUSE_MS);
    } catch (err) {
      console.error("Changing the password failed", err);
      showMessage(message, page.errorMessage({ code: "SERVER_ERROR" }));
    } finally {
      setBusy(button, "", false);
    }
  });
}

main().catch((err) => console.error("The password screen could not start", err));
