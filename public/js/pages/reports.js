// scope: shared
// Reports (main spec §7 R3–R7): one screen, a report picker, the filters each report needs, and an
// output that is a table for the row-shaped reports or CSS bar charts for the demographics. All the
// maths ran server-side (Reports.gs → shared/reports.js); this screen only renders what came back and
// hands the same rows to xlsx.js for the Excel download (main spec §11.1).
import { startPage, showMessage, goTo, PAGES } from "../page.js";
import { downloadXlsx } from "../xlsx.js";

const { SC_FormSchema, SC_Reports, SC_Workflow } = window;
const $ = (id) => document.getElementById(id);

// The demographics report is the one drawn as bars; the other four are rows in a table. `name` in the
// payload below is the key Reports.gs switches on.
const DIMENSIONS = ["age", "gender", "conditions", "udid", "income"];
const FILTERS = {
  register: ["centre", "status", "program", "from", "to"],
  monthly: ["centre", "from", "to"],
  turnaround: ["centre", "status"],
  waitlist: ["centre", "program"],
  demographics: ["centre", "program", "age", "from", "to"],
};

const state = { page: null, me: null, report: "register", pageNo: 1, data: null, loaded: false };

const t = (key, vars) => state.page.t(key, vars);
const lang = () => state.page.prefs().lang;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function optionLabel(list, value) {
  const found = list.find((o) => o.value === value);
  return found ? (lang() === "en" ? found.en : found.ta) : value || "";
}

const shortDate = (iso) => String(iso || "").slice(0, 10);

function visibleFilters(report) {
  [["centre", "centre-field"], ["status", "status-field"], ["program", "program-field"],
    ["age", "age-field"], ["from", "from-field"], ["to", "to-field"]].forEach(([key, id]) => {
    $(id).hidden = !FILTERS[report].includes(key);
  });
}

// Only the fields the current report uses are read, so a stale value left in a hidden filter from a
// previous report never leaks into the request.
function filters() {
  const f = {};
  const pick = (key, id) => { if (FILTERS[state.report].includes(key)) f[key] = $(id).value || null; };
  pick("centre", "f-centre");
  pick("status", "f-status");
  pick("program", "f-program");
  pick("age", "f-age");
  pick("from", "f-from");
  pick("to", "f-to");
  return f;
}

function sheet(data) {
  if (state.report === "register") {
    return {
      headers: ["appNo", "regNo", "name", "age", "gender", "centre", "status", "therapist", "submitted", "suitability"].map((k) => t(`reports.col.${k}`)),
      rows: data.items.map((r) => [
        r.appNo, r.registrationNo, r.name, r.age == null ? "" : String(r.age),
        optionLabel(SC_FormSchema.OPTIONS.GENDER, r.gender), optionLabel(SC_FormSchema.OPTIONS.CENTRE, r.centre),
        t(`status.${r.status}`), r.therapist, shortDate(r.submitted), r.suitability || "",
      ]),
    };
  }
  if (state.report === "waitlist") {
    return {
      headers: ["appNo", "name", "centre", "programs", "waitlistedOn", "therapist"].map((k) => t(`reports.col.${k}`)),
      rows: data.items.map((r) => [
        r.appNo, r.name, optionLabel(SC_FormSchema.OPTIONS.CENTRE, r.centre),
        r.programs.map((p) => optionLabel(SC_FormSchema.OPTIONS.PROGRAMS, p)).join(", "),
        shortDate(r.waitlistedOn), r.therapist,
      ]),
    };
  }
  if (state.report === "turnaround") {
    return {
      headers: ["appNo", "name", "centre", "status", "days"].map((k) => t(`reports.col.${k}`)),
      rows: data.pending.map((r) => [
        r.appNo, r.name, optionLabel(SC_FormSchema.OPTIONS.CENTRE, r.centre), t(`status.${r.status}`),
        r.daysInStage == null ? "" : (r.overdue ? "⚠ " + r.daysInStage : String(r.daysInStage)),
      ]),
    };
  }
  return {
    headers: ["centre", "month", "submittedCount", "admitted", "waitlisted", "rejected"].map((k) => t(`reports.col.${k}`)),
    rows: data.items.map((r) => [
      optionLabel(SC_FormSchema.OPTIONS.CENTRE, r.centre), r.month, String(r.submitted), String(r.admitted), String(r.waitlisted), String(r.rejected),
    ]),
  };
}

function demographicsSheet(data) {
  const headers = [t("reports.col.dimension"), t("reports.col.category"), t("reports.col.count")];
  const rows = [];
  DIMENSIONS.forEach((key) => {
    data[key].forEach((row) => rows.push([t(`reports.dim.${key}`), lang() === "en" ? row.en : row.ta, String(row.count)]));
  });
  return { headers, rows };
}

function renderTable(rows) {
  const wrap = el("div", "table-wrap");
  const table = el("table", "report-table");
  const thead = el("thead");
  const headRow = el("tr");
  rows.headers.forEach((h) => headRow.append(el("th", "", h)));
  thead.append(headRow);
  const tbody = el("tbody");
  rows.rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((cell) => tr.append(el("td", "", cell)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderBars(title, list) {
  const max = Math.max(1, ...list.map((r) => r.count));
  const box = el("div");
  box.append(el("h3", "muted", title));
  const chart = el("div", "bar-chart");
  list.forEach((row) => {
    const rowEl = el("div", "bar-row");
    rowEl.append(el("span", "bar-label", lang() === "en" ? row.en : row.ta));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = `${Math.round((row.count / max) * 100)}%`;
    track.append(fill);
    rowEl.append(track);
    rowEl.append(el("span", "bar-count", String(row.count)));
    chart.append(rowEl);
  });
  box.append(chart);
  return box;
}

function draw() {
  const { data, loaded } = state;
  $("output").replaceChildren();
  $("summary").hidden = true;
  $("download").hidden = true;
  $("empty").hidden = true;
  if (!loaded || !data) return;

  if (state.report === "demographics") {
    DIMENSIONS.forEach((key) => $("output").append(renderBars(t(`reports.dim.${key}`), data[key])));
  } else {
    $("output").append(renderTable(sheet(data)));
    const total = state.report === "turnaround" ? data.pending.length : (data.items ? data.items.length : 0);
    $("empty").hidden = total > 0;
    if (state.report === "turnaround") {
      $("summary").textContent = t("reports.avgDays") + ": " + data.avgDaysPerStage.map((s) => `${t(`role.${s.stage}`)} ${s.avgDays == null ? "—" : s.avgDays}`).join(" · ");
      $("summary").hidden = false;
    }
  }
  $("download").hidden = false;
}

async function load() {
  state.loaded = false;
  const result = await state.page.api.call("reports.get", { name: state.report, filters: filters(), page: state.pageNo });
  if (!result.ok) {
    showMessage($("message"), state.page.errorMessage(result.error));
    return;
  }
  showMessage($("message"), "");
  state.data = result.data;
  state.loaded = true;
  draw();
}

function pickerOptions(list, allKey) {
  const all = el("option", "", t(allKey));
  all.value = "";
  return [all].concat(list.map((o) => {
    const opt = el("option", "", lang() === "en" ? o.en : o.ta);
    opt.value = o.value !== undefined ? o.value : o.id;
    return opt;
  }));
}

function fillFilters() {
  // Rebuilding a select clears its chosen value, so remember and restore it (a language change
  // re-runs this to re-translate the option labels).
  const selected = { centre: $("f-centre").value, status: $("f-status").value, program: $("f-program").value, age: $("f-age").value };
  $("f-centre").replaceChildren(...pickerOptions(SC_FormSchema.OPTIONS.CENTRE, "reports.allCentres"));
  $("f-status").replaceChildren(...pickerOptions(
    Object.values(SC_Workflow.STATUS).map((value) => ({ value, en: t(`status.${value}`), ta: t(`status.${value}`) })),
    "reports.allStatuses"
  ));
  $("f-program").replaceChildren(...pickerOptions(SC_FormSchema.OPTIONS.PROGRAMS, "reports.allPrograms"));
  $("f-age").replaceChildren(...pickerOptions(SC_Reports.AGE_BANDS, "reports.allAges"));
  $("f-centre").value = selected.centre;
  $("f-status").value = selected.status;
  $("f-program").value = selected.program;
  $("f-age").value = selected.age;
  if (state.me.centre) {
    $("f-centre").value = state.me.centre;
    $("f-centre").disabled = true;
  }
}

function pickReport() {
  $("report").replaceChildren(...["register", "monthly", "turnaround", "waitlist", "demographics"].map((id) => {
    const opt = el("option", "", t(`reports.${id}`));
    opt.value = id;
    return opt;
  }));
  $("report").value = state.report;
  visibleFilters(state.report);
  $("report").addEventListener("change", () => {
    state.report = $("report").value;
    state.pageNo = 1;
    visibleFilters(state.report);
    load();
  });
}

function download() {
  if (!state.loaded || !state.data) return;
  const base = state.report === "demographics" ? demographicsSheet(state.data) : sheet(state.data);
  downloadXlsx(`report-${state.report}-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: t(`reports.${state.report}`), headers: base.headers, rows: base.rows },
  ]);
}

async function main() {
  const page = await startPage({ requireSignIn: true });
  if (!page) return;
  const me = await page.api.call("me.get");
  if (!me.ok) { showMessage($("message"), page.errorMessage(me.error)); return; }
  if (me.data.mustChangePassword) { goTo(PAGES.password); return; }
  // The account's saved choices win, so every phone looks the same for this person.
  page.setPrefs({ lang: me.data.preferredLang, theme: me.data.preferredTheme });
  state.page = page;
  state.me = me.data;
  pickReport();
  fillFilters();
  page.onRender(() => { fillFilters(); draw(); });
  $("apply").addEventListener("click", () => { state.pageNo = 1; load(); });
  $("download").addEventListener("click", download);
  await load();
}

main().catch((err) => console.error("The reports screen could not start", err));
