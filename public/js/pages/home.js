// scope: shared
// Home: greets the signed-in person. My Queue arrives here in M6.
import { startPage, showMessage, goTo, PAGES } from "../page.js";

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const me = await page.api.call("me.get");
  if (!me.ok) {
    showMessage(document.getElementById("message"), page.errorMessage(me.error));
    return;
  }
  const user = me.data;
  if (user.mustChangePassword) {
    goTo(PAGES.password);
    return;
  }
  // The account's saved choices win, so every phone looks the same for this person.
  page.setPrefs({ lang: user.preferredLang, theme: user.preferredTheme });
  page.onRender(() => {
    document.getElementById("greeting").textContent = page.t("home.greeting", { name: user.name });
    document.getElementById("role-line").textContent = user.roles.map((role) => page.t(`role.${role}`)).join(" · ");
  });
}

main().catch((err) => console.error("The home screen could not start", err));
