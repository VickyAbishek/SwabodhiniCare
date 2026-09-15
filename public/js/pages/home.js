// scope: shared
// Home: what needs this person's action (main spec §7 R1). The count and the cards show the
// applications they can see — their own for therapists, everyone's for heads, Director and Admin —
// with the rows waiting on them first, each one placed on its four-step route. The list keeps itself
// fresh every 60 seconds while it is on the screen (POC spec §8).
import { startPage, showMessage, setBusy, goTo, PAGES } from "../page.js";
import { createRoutingSlip, trackElement } from "../routing-slip.js";

const { SC_Workflow, SC_Dates, SC_FormSchema, SC_Permissions } = window;
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 60 * 1000;
const OVERDUE_DAYS = 7; // main spec §7 R5: a week in a queue is long enough
// Only a file somebody is actually waiting for can be late — a reviewer's queue, or one sent back
// and sitting with the therapist. A draft is being worked on rather than waiting, and a waitlisted,
// admitted, rejected or withdrawn file is not late for anyone, so no such card says "Waiting 10 days".
const WAITING = ["PENDING_THERAPY_HEAD", "PENDING_CENTRE_HEAD", "PENDING_DIRECTOR", "RETURNED"];

// The school's day, not UTC's: an application must not turn overdue an evening early.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shortDate = (iso, lang) =>
  new Date(iso).toLocaleDateString(lang === "en" ? "en-IN" : "ta-IN", { day: "numeric", month: "short" });

const state = { page: null, slip: null, me: null, items: null };

function span(className, text) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

// Whose move it is, from the workflow itself: the file is waiting on this person. Not "could they act
// on it" — a Director can reopen an admitted file and an Admin can withdraw a draft, and stamping
// those would count and sort work that is waiting for nobody.
function myTurn(item, me) {
  return SC_Workflow.isMyTurn(item.status, { actorId: me.id, actorRoles: me.roles, createdBy: item.createdBy });
}

// "19 yrs · Male · Selaiyur". The age is worked out from the date of birth every time it is drawn,
// so it is right even when the application has sat in the queue since a birthday.
function subtitle(page, item) {
  const lang = page.prefs().lang;
  return [
    ageText(page, item),
    SC_FormSchema.optionLabel("GENDER", item.gender, lang),
    SC_FormSchema.optionLabel("CENTRE", item.centre, lang),
  ].filter(Boolean).join(" · ");
}

function ageText(page, item) {
  if (!item.dob) return "";
  try {
    return page.t("queue.ageYears", { n: SC_Dates.ageFrom(item.dob, today()).years });
  } catch (err) {
    return ""; // a date that is not a real one: the card shows the rest of the line without it
  }
}

function card(page, slip, item, me) {
  const link = document.createElement("a");
  link.className = "app-card";
  link.href = `application.html?id=${encodeURIComponent(item.id)}`;
  const top = document.createElement("div");
  top.className = "app-card-top";
  const who = document.createElement("div");
  who.className = "app-who";
  who.append(span("app-name", item.applicantName || page.t("form.untitled")));
  const sub = subtitle(page, item);
  if (sub) who.append(span("app-sub", sub));
  top.append(who);
  if (myTurn(item, me)) top.append(span("stamp stamp-turn", page.t("queue.yourTurn")));
  link.append(top);

  // The flag is past seven days, so the count is always plural: no "(1) days" wording can reach it.
  const waited = SC_Dates.daysBetween(dayOf(item.updatedAt), today());
  if (WAITING.includes(item.status) && waited > OVERDUE_DAYS) {
    link.append(span("flag flag-bad", page.t("queue.waitingDays", { n: waited })));
  }

  link.append(trackElement(slip.track(item.status), page.t));
  const ref = document.createElement("p");
  ref.className = "app-ref";
  ref.append(span("mono", item.appNo));
  if (item.createdByName) ref.append(document.createTextNode(` · ${page.t("queue.from", { name: item.createdByName })}`));
  link.append(ref);

  const row = document.createElement("li");
  row.append(link);
  return row;
}

// Rows waiting on this person first (main spec §7 R1). The server's newest-first order stands inside
// each group, so the queue reads the same way every time it is refreshed.
function order(items, me) {
  return items.slice().sort((a, b) => Number(myTurn(b, me)) - Number(myTurn(a, me)));
}

// The count keeps its own big element (the mockup makes the number the point of this screen), so the
// sentence beside it is the same key with the count taken out. The sentence is chosen by the count
// because "{n} applications are waiting" is wrong in both languages when one is waiting — a therapist
// with a single application in their queue is the common case, not a corner.
function heroText(page, waiting) {
  if (waiting === 0) return page.t("queue.empty");
  return page.t(waiting === 1 ? "queue.waitingOne" : "queue.waiting", { n: "" }).trim();
}

function draw() {
  const { page, me, slip, items } = state;
  $("greeting").textContent = page.t("home.greeting", { name: me.name });
  $("role-line").textContent = me.roles.map((role) => page.t(`role.${role}`)).join(" · ");
  if (!items) return; // the first answer is still on its way
  const waiting = items.filter((item) => myTurn(item, me)).length;
  $("queue-count").textContent = waiting === 0 ? "" : String(waiting);
  $("queue-state").textContent = heroText(page, waiting);
  $("app-list").replaceChildren(...items.map((item) => card(page, slip, item, me)));
  $("list-empty").hidden = items.length > 0;
}

async function load() {
  try {
    const result = await state.page.api.call("applications.list", {});
    if (!result.ok) {
      showMessage($("message"), state.page.errorMessage(result.error));
      return;
    }
    showMessage($("message"), "");
    state.items = order(result.data.items, state.me);
    draw();
  } catch (err) {
    showMessage($("message"), state.page.errorMessage({ code: "NETWORK_ERROR" }));
    console.error("The queue could not be loaded", err);
  }
}

// POC spec §8: freshly loaded while the screen is on show, paused when the tab is hidden, and stopped
// for good once the person has left the page.
function keepFresh() {
  let timer = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = setInterval(load, REFRESH_MS);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      return;
    }
    load(); // coming back to the tab is the same as opening the screen
    start();
  });
  window.addEventListener("pagehide", stop);
  start();
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
  state.page = page;
  state.me = user;
  // The queue asks this for the four-step track alone; the slip itself belongs to the review screen,
  // so the factory is handed the translator and the date formatter both need.
  state.slip = createRoutingSlip({ workflow: SC_Workflow, t: page.t, formatDate: (iso) => shortDate(iso, page.prefs().lang) });
  // Drawn in code, so a language change redraws the count, the cards and the track with it.
  page.onRender(draw);
  $("new-application").hidden = !SC_Permissions.can(user.roles, "application.create");
  $("refresh").addEventListener("click", () => refresh());
  keepFresh();
  await load();
}

async function refresh() {
  const button = $("refresh");
  setBusy(button, state.page.t("common.working"), true);
  await load();
  setBusy(button, "", false);
}

main().catch((err) => console.error("The home screen could not start", err));
