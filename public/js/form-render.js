// scope: shared
// Builds one question on the screen from its form-view model, with the DOM only (no innerHTML).
// ctx = { t, today, view, readOnly, errorText(fieldId), onAnswer(fieldId, raw, redraw) }.
const YEARS_BACK = { s2_dob: 100 }; // other dates: the last 2 years

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([name, value]) => {
    if (value === true) node.setAttribute(name, "");
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, String(value));
  });
  if (text !== undefined) node.textContent = text;
  return node;
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function labelFor(field, ctx, forId) {
  const node = forId ? el("label", { for: forId }, field.label) : el("span", { class: "label", id: `${field.id}-label` }, field.label);
  if (field.required) node.append(" ", el("span", { class: "req" }, ctx.t("common.required")));
  return node;
}

function errorAttrs(field, ctx) {
  const text = ctx.errorText(field.id);
  return { "aria-invalid": text ? "true" : "false", "aria-describedby": text ? `${field.id}-error` : null };
}

function textInput(field, ctx) {
  const multiline = field.type === "textarea";
  const input = el(multiline ? "textarea" : "input", Object.assign({ class: "input", id: field.id, name: field.id, disabled: ctx.readOnly }, errorAttrs(field, ctx)));
  if (!multiline) {
    input.type = "text";
    const mode = { phone: "tel", pincode: "numeric", number: field.decimals ? "decimal" : "numeric" }[field.type];
    if (mode) input.inputMode = mode;
  }
  input.value = field.value === null ? "" : String(field.value);
  input.addEventListener("input", () => ctx.onAnswer(field.id, input.value, false));
  input.addEventListener("change", () => ctx.onAnswer(field.id, input.value, true));
  return input;
}

function choiceGroup(field, ctx) {
  const multi = field.type === "multi";
  const count = field.options.length;
  const layout = multi || count > 3 ? " list" : count === 3 ? " three" : "";
  const group = el("div", { class: `choices${layout}`, role: "group", "aria-labelledby": `${field.id}-label` });
  field.options.forEach((option) => {
    // The id lets focus return to this button after the step is redrawn.
    const button = el("button", {
      type: "button", class: "choice", id: `${field.id}-${option.value}`,
      "aria-pressed": String(option.selected), disabled: ctx.readOnly,
    }, option.label);
    button.addEventListener("click", () => {
      const current = Array.isArray(field.value) ? field.value : [];
      const next = multi
        ? (current.includes(option.value) ? current.filter((v) => v !== option.value) : current.concat(option.value))
        : option.value;
      ctx.onAnswer(field.id, next, true);
    });
    group.append(button);
  });
  return group;
}

function dateInput(field, ctx) {
  const parts = ctx.view.dateParts(field.value);
  const thisYear = Number(ctx.today.slice(0, 4));
  const years = range(thisYear - (YEARS_BACK[field.id] || 2), thisYear).reverse();
  const wrap = el("div", { class: "dob", role: "group", "aria-labelledby": `${field.id}-label` });
  const selects = {};
  const make = (name, labelKey, options) => {
    const select = el("select", { class: "input select", id: `${field.id}-${name}`, "aria-label": ctx.t(labelKey), disabled: ctx.readOnly });
    select.append(el("option", { value: "" }, ctx.t(labelKey)));
    options.forEach(([value, text]) => select.append(el("option", { value }, text)));
    select.value = parts[name];
    select.addEventListener("change", () => {
      const iso = ctx.view.dateFromParts({ day: selects.day.value, month: selects.month.value, year: selects.year.value });
      ctx.onAnswer(field.id, iso, iso !== null); // redraw only once all three are chosen
    });
    selects[name] = select;
    return select;
  };
  wrap.append(
    make("day", "form.day", range(1, 31).map((d) => [String(d), String(d)])),
    make("month", "form.month", range(1, 12).map((m) => [String(m), ctx.t(`month.${m}`)])),
    make("year", "form.year", years.map((y) => [String(y), String(y)])),
  );
  return wrap;
}

function consentInput(field, ctx) {
  const box = el("input", { type: "checkbox", id: field.id, disabled: ctx.readOnly });
  box.checked = field.value === true;
  box.addEventListener("change", () => ctx.onAnswer(field.id, box.checked, true));
  const check = el("label", { class: "check", for: field.id });
  check.append(box, el("span", {}, ctx.t("form.consentAgree")));
  if (field.required) check.append(el("span", { class: "req" }, ctx.t("common.required")));
  return [el("p", { class: "consent" }, field.label), check];
}

export function renderQuestion(field, ctx) {
  const q = el("div", { class: "q", "data-field": field.id });
  if (field.type === "consent") {
    q.append(...consentInput(field, ctx));
  } else if (field.waitsForUploads) {
    q.append(labelFor(field, ctx), el("p", { class: "note" }, ctx.t("form.waitsForUploads")));
  } else if (field.type === "choice" || field.type === "multi") {
    q.append(labelFor(field, ctx), choiceGroup(field, ctx));
  } else if (field.type === "date") {
    q.append(labelFor(field, ctx), dateInput(field, ctx));
    const age = field.id === "s2_dob" ? ctx.view.age(field.value, ctx.today) : null;
    if (age) q.append(el("span", { class: "derived" }, ctx.t("form.age", age)));
  } else {
    q.append(labelFor(field, ctx, field.id), textInput(field, ctx));
  }
  if (field.safety && field.value === "OFTEN") q.append(el("span", { class: "flag" }, ctx.t("form.safety")));
  const error = ctx.errorText(field.id);
  const box = el("p", { class: "field-error", id: `${field.id}-error` }, error || "");
  box.hidden = !error;
  q.append(box);
  return q;
}
