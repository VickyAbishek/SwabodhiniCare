// scope: shared
// Settings (screen S13): language and light/dark, saved to the account (me.update) and on this
// phone, plus account details, change password and sign out. Light stays the default (D23).
import { startPage, showMessage, goTo, PAGES } from "../page.js";

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
