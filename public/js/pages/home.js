// scope: shared
// Home: greets the signed-in person, starts a new application and lists applications they can
// see (their own for therapists; everyone's for heads, Director and Admin). My Queue arrives in M6.
import { startPage, showMessage, goTo, PAGES } from "../page.js";

const $ = (id) => document.getElementById(id);

function span(className, text) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function card(page, item) {
  const link = document.createElement("a");
  link.className = "app-card";
  link.href = `application.html?id=${encodeURIComponent(item.id)}`;
  const top = document.createElement("div");
  top.className = "app-card-top";
  const stamp = span("stamp", page.t(`status.${item.status}`));
  stamp.dataset.status = item.status;
  top.append(span("app-name", item.applicantName || page.t("form.untitled")), stamp);
  const updated = new Date(item.updatedAt).toLocaleDateString(page.prefs().lang === "en" ? "en-IN" : "ta-IN", { day: "numeric", month: "short" });
  link.append(top, span("app-ref mono", `${item.appNo} · ${updated}`));
  const row = document.createElement("li");
  row.append(link);
  return row;
}

async function showList(page, seesAll) {
  const result = await page.api.call("applications.list", {});
  if (!result.ok) {
    showMessage($("message"), page.errorMessage(result.error));
    return;
  }
  const title = $("list-title");
  title.dataset.i18n = seesAll ? "home.allApplications" : "home.myApplications";
  page.onRender(() => {
    title.textContent = page.t(title.dataset.i18n);
    $("app-list").replaceChildren(...result.data.items.map((item) => card(page, item)));
    $("list-empty").hidden = result.data.items.length > 0;
  });
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const me = await page.api.call("me.get");
  if (!me.ok) {
    showMessage($("message"), page.errorMessage(me.error));
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
    $("greeting").textContent = page.t("home.greeting", { name: user.name });
    $("role-line").textContent = user.roles.map((role) => page.t(`role.${role}`)).join(" · ");
  });
  $("new-application").hidden = !window.SC_Permissions.can(user.roles, "application.create");
  await showList(page, window.SC_Permissions.can(user.roles, "application.viewAll"));
}

main().catch((err) => console.error("The home screen could not start", err));
