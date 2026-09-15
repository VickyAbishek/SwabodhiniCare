// scope: shared
// Screen text in Tamil or English (main spec §12). Text is always set with textContent, never as HTML.
export const LANGS = Object.freeze(["ta", "en"]);
const DEFAULT_LANG = "ta";

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (has(vars, name) ? String(vars[name]) : match));
}

// Looks a key up in the chosen language, then English, then shows the key itself.
export function createI18n(dictionaries, lang) {
  const current = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  const own = dictionaries[current] || {};
  const english = dictionaries.en || {};

  function t(key, vars) {
    const text = has(own, key) ? own[key] : has(english, key) ? english[key] : key;
    return fill(text, vars);
  }

  return Object.freeze({ lang: current, t });
}

// Fills every element marked data-i18n="key" (text) or data-i18n-aria="key" (accessible label).
export function applyTranslations(root, i18n) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = i18n.t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", i18n.t(el.dataset.i18nAria));
  });
}

// The message for a server error code, in the chosen language (texts live in shared/actions.js).
export function errorText(error, lang, errors) {
  const entry = (error && errors[error.code]) || errors.SERVER_ERROR;
  return lang === "en" ? entry.en : entry.ta;
}

// Names written as a list in the sentence's own language: "Priya S and Suresh M" / "Priya S மற்றும்
// Suresh M". The joining word comes from the dictionary (common.and) rather than being glued in
// English, because Tamil puts its own word between the names and would otherwise end up with an
// English "and" inside a Tamil sentence.
export function joinNames(names, t) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} ${t("common.and")} ${list[list.length - 1]}`;
}

export async function loadDictionaries(fetchImpl, base = "i18n") {
  const [en, ta] = await Promise.all(["en", "ta"].map(async (lang) => {
    const response = await fetchImpl(`${base}/${lang}.json`);
    if (!response.ok) throw new Error(`Could not load ${base}/${lang}.json (HTTP ${response.status})`);
    return response.json();
  }));
  return { en, ta };
}
