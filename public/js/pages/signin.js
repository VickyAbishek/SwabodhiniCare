// scope: shared
// Sign in (main spec §10.1): ask the server for this email's salt, turn the password into a key on
// the phone, then send only the key. The password itself never leaves the phone.
import { startPage, showMessage, setBusy, fieldError, goTo, PAGES } from "../page.js";
import { deriveKey } from "../kdf.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function signIn(page, email, password) {
  const pre = await page.api.call("auth.prelogin", { email });
  if (!pre.ok) return pre;
  const key = await deriveKey(password, pre.data.salt, pre.data.iterations);
  return page.api.call("auth.login", { email, key });
}

function checkForm(page, email, password) {
  const emailOk = EMAIL.test(email);
  fieldError("email", emailOk ? "" : page.t("signin.emailMissing"));
  fieldError("password", password ? "" : page.t("signin.passwordMissing"));
  return emailOk && Boolean(password);
}

async function main() {
  const page = await startPage();
  if (page.api.isSignedIn()) {
    goTo(PAGES.home);
    return;
  }
  const form = document.getElementById("signin-form");
  const button = document.getElementById("submit");
  const message = document.getElementById("message");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    if (!checkForm(page, email, password)) return;
    showMessage(message, "");
    setBusy(button, page.t("signin.working"), true);
    try {
      const result = await signIn(page, email, password);
      if (!result.ok) {
        showMessage(message, page.errorMessage(result.error));
        return;
      }
      const user = result.data.user;
      page.setPrefs({ lang: user.preferredLang, theme: user.preferredTheme });
      goTo(user.mustChangePassword ? PAGES.password : PAGES.home);
    } catch (err) {
      console.error("Sign-in failed", err);
      showMessage(message, page.errorMessage({ code: "SERVER_ERROR" }));
    } finally {
      setBusy(button, "", false);
    }
  });
}

main().catch((err) => console.error("The sign-in screen could not start", err));
