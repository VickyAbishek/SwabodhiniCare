// scope: shared
// Turns the form definition into what one step's screen shows, and screen input back into answers.
// Pure (no DOM): the schema, rules and date helpers are passed in (globals SC_* in the browser).
const UPLOAD_TYPES = ["file"]; // photos and PDFs arrive in M7b; the signature pad landed in M7a

function isBlank(value) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

export function createFormView({ schema, rules, dates }) {
  const steps = schema.STEPS;
  const label = (item, lang) => (lang === "en" ? item.en : item.ta);

  function optionsFor(field, value, lang) {
    if (!field.options) return undefined;
    const chosen = Array.isArray(value) ? value : [value];
    return schema.OPTIONS[field.options].map((o) => ({ value: o.value, label: label(o, lang), selected: chosen.includes(o.value) }));
  }

  function fieldModel(field, values, lang) {
    return {
      id: field.id,
      type: field.type,
      label: label(field, lang),
      required: Boolean(field.required),
      value: values[field.id] === undefined ? null : values[field.id],
      options: optionsFor(field, values[field.id], lang),
      waitsForUploads: UPLOAD_TYPES.includes(field.type),
      min: field.min,
      max: field.max,
      decimals: Boolean(field.decimals),
      safety: Boolean(field.safety),
    };
  }

  // The questions that apply right now, with labels and answer lists in the chosen language.
  function stepModel(stepId, values, today, lang) {
    const index = steps.findIndex((s) => s.id === stepId);
    if (index === -1) throw new Error(`Unknown step: ${stepId}`);
    const step = steps[index];
    return {
      id: step.id,
      number: index + 1,
      total: steps.length,
      title: label(step, lang),
      fields: step.fields.filter((f) => rules.isVisible(f, values, today)).map((f) => fieldModel(f, values, lang)),
    };
  }

  // Tidies what was typed or tapped into an answer of the right type. Anything that can't be
  // understood is passed through unchanged, so the checks can explain what is wrong.
  function parseInput(fieldId, raw) {
    const field = schema.fieldById(fieldId);
    if (!field) throw new Error(`Unknown question: ${fieldId}`);
    if (field.type === "multi" || field.type === "file") return Array.isArray(raw) ? raw.slice() : [];
    if (field.type === "consent") return raw === true;
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (text === "") return null;
    if (field.type === "phone" || field.type === "pincode") return text.replace(/[\s-]/g, "");
    if (field.type === "number") {
      const number = Number(text);
      return Number.isFinite(number) ? number : text;
    }
    return text;
  }

  // Day / month / year dropdowns → "YYYY-MM-DD", or null until all three are chosen.
  function dateFromParts(parts) {
    if (!parts.day || !parts.month || !parts.year) return null;
    const pad = (value, size) => String(Number(value)).padStart(size, "0");
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  }

  function dateParts(iso) {
    const match = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
    if (!match) return { day: "", month: "", year: "" };
    return { day: String(Number(match[3])), month: String(Number(match[2])), year: match[1] };
  }

  function age(dob, today) {
    if (!dob) return null;
    try {
      return dates.ageFrom(dob, today);
    } catch (err) {
      return null; // not a real date yet (for example 30 February while still choosing)
    }
  }

  // Answers that differ between two copies; a removed answer is sent as null.
  function changedValues(before, after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = {};
    keys.forEach((key) => {
      const was = isBlank(before[key]) ? null : before[key];
      const now = isBlank(after[key]) ? null : after[key];
      if (JSON.stringify(was) !== JSON.stringify(now)) changed[key] = now;
    });
    return changed;
  }

  return Object.freeze({
    stepIds: Object.freeze(steps.map((s) => s.id)),
    stepModel,
    parseInput,
    dateFromParts,
    dateParts,
    age,
    changedValues,
  });
}
