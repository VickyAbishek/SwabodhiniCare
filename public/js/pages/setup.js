// scope: shared
// First-time setup: creates the first Admin with the one-time setup code, then signs them in.
// The POC server issues the code from setup() in Apps Script; production issues it the same way.
import { startPage, showMessage, setBusy, fieldError, goTo, PAGES } from "../page.js";
import { CONFIG } from "../config.js";
import { deriveKey, newSalt, checkPassword } from "../kdf.js";

const CODE = /^[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readForm() {
  const value = (id) => document.getElementById(id).value;
  return {
    code: value("code").trim().toLowerCase(),
    name: value("fullName").trim(),
    email: value("email").trim().toLowerCase(),
    password: value("password"),
    again: value("password2"),
  };
}

function checkForm(page, form) {
  const passwordProblem = checkPassword(form.password);
  const problems = {
    code: CODE.test(form.code) ? "" : page.t("setup.codeInvalid"),
    fullName: form.name ? "" : page.t("setup.nameMissing"),
    email: EMAIL.test(form.email) ? "" : page.t("signin.emailMissing"),
    password: passwordProblem ? page.t(passwordProblem) : "",
    password2: form.password === form.again ? "" : page.t("password.mismatch"),
  };
  Object.entries(problems).forEach(([id, text]) => fieldError(id, text));
  return Object.values(problems).every((text) => !text);
}

async function createAdmin(page, form) {
  const salt = newSalt();
  const key = await deriveKey(form.password, salt, CONFIG.KDF_ITERATIONS);
  const created = await page.api.call("setup.firstAdmin", { code: form.code, email: form.email, name: form.name, salt, key });
  if (!created.ok) return created;
  return page.api.call("auth.login", { email: form.email, key });
}

async function main() {
  const page = await startPage();
  const button = document.getElementById("submit");
  const message = document.getElementById("message");

  document.getElementById("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = readForm();
    if (!checkForm(page, form)) return;
    showMessage(message, "");
    setBusy(button, page.t("setup.working"), true);
    try {
      const result = await createAdmin(page, form);
      if (!result.ok) {
        showMessage(message, page.errorMessage(result.error));
        return;
      }
      goTo(PAGES.home);
    } catch (err) {
      console.error("First-time setup failed", err);
      showMessage(message, page.errorMessage({ code: "SERVER_ERROR" }));
    } finally {
      setBusy(button, "", false);
    }
  });
}

main().catch((err) => console.error("The setup screen could not start", err));
