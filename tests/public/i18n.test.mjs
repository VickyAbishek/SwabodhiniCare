import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createI18n, applyTranslations, errorText, loadDictionaries, joinNames } from "../../public/js/i18n.js";
import { saveStatusKey } from "../../public/js/autosave.js";
import { readPrefs, savePrefs, applyPrefs } from "../../public/js/prefs.js";

const require = createRequire(import.meta.url);
const SC_Actions = require("../../shared/actions.js");
const dictionary = (lang) => JSON.parse(readFileSync(new URL(`../../public/i18n/${lang}.json`, import.meta.url), "utf8"));
const EN = dictionary("en");
const TA = dictionary("ta");

test("English and Tamil have exactly the same keys, all with text", () => {
  assert.deepEqual(Object.keys(TA).sort(), Object.keys(EN).sort());
  for (const [key, text] of Object.entries(EN)) assert.ok(text.trim() && TA[key].trim(), key);
});

test("placeholders like {name} appear in both languages", () => {
  for (const [key, text] of Object.entries(EN)) {
    const names = (s) => (s.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(names(TA[key]), names(text), key);
  }
});

test("t() uses the chosen language, fills values, and falls back to English then the key", () => {
  const i18n = createI18n({ en: { hi: "Hello, {name}", only: "English only" }, ta: { hi: "வணக்கம், {name}" } }, "ta");
  assert.equal(i18n.lang, "ta");
  assert.equal(i18n.t("hi", { name: "Priya" }), "வணக்கம், Priya");
  assert.equal(i18n.t("only"), "English only");
  assert.equal(i18n.t("missing.key"), "missing.key");
  assert.equal(i18n.t("hi"), "வணக்கம், {name}");
});

test("an unknown language falls back to Tamil, the default", () => {
  assert.equal(createI18n({ en: {}, ta: {} }, "fr").lang, "ta");
  assert.equal(createI18n({ en: {}, ta: {} }, "en").lang, "en");
});

test("applyTranslations fills text and accessible labels, never HTML", () => {
  const el = (attrs) => ({ dataset: attrs, textContent: "", attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } });
  const title = el({ i18n: "hi" });
  const button = el({ i18nAria: "hi" });
  const root = { querySelectorAll: (sel) => (sel === "[data-i18n]" ? [title] : sel === "[data-i18n-aria]" ? [button] : []) };
  applyTranslations(root, createI18n({ en: { hi: "<b>Hi</b>" }, ta: {} }, "en"));
  assert.equal(title.textContent, "<b>Hi</b>");
  assert.equal(button.attributes["aria-label"], "<b>Hi</b>");
});

test("errorText shows the server's error in the chosen language", () => {
  const error = { code: "ACCOUNT_LOCKED" };
  assert.equal(errorText(error, "en", SC_Actions.ERRORS), SC_Actions.ERRORS.ACCOUNT_LOCKED.en);
  assert.equal(errorText(error, "ta", SC_Actions.ERRORS), SC_Actions.ERRORS.ACCOUNT_LOCKED.ta);
  assert.equal(errorText({ code: "WHAT" }, "en", SC_Actions.ERRORS), SC_Actions.ERRORS.SERVER_ERROR.en);
});

test("loadDictionaries fetches both files", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ from: url }) };
  };
  const dicts = await loadDictionaries(fetchImpl, "i18n");
  assert.deepEqual(asked.sort(), ["i18n/en.json", "i18n/ta.json"]);
  assert.deepEqual(dicts.en, { from: "i18n/en.json" });
  await assert.rejects(loadDictionaries(async () => ({ ok: false, status: 404 }), "i18n"), /404/);
});

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

test("prefs default to Tamil and light, and ignore bad stored values", () => {
  assert.deepEqual(readPrefs(memoryStorage()), { lang: "ta", theme: "light" });
  assert.deepEqual(readPrefs(memoryStorage({ "sc-lang": "en", "sc-theme": "dark" })), { lang: "en", theme: "dark" });
  assert.deepEqual(readPrefs(memoryStorage({ "sc-lang": "fr", "sc-theme": "blue" })), { lang: "ta", theme: "light" });
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.deepEqual(readPrefs(blocked), { lang: "ta", theme: "light" });
  assert.doesNotThrow(() => savePrefs(blocked, { lang: "en", theme: "dark" }));
});

test("savePrefs stores only valid values; applyPrefs sets theme and language on the page", () => {
  const storage = memoryStorage();
  savePrefs(storage, { lang: "en", theme: "dark" });
  assert.equal(storage.getItem("sc-lang"), "en");
  assert.equal(storage.getItem("sc-theme"), "dark");
  savePrefs(storage, { theme: "blue" });
  assert.equal(storage.getItem("sc-theme"), "dark");
  const root = { dataset: {}, lang: "" };
  applyPrefs(root, { lang: "en", theme: "dark" });
  assert.deepEqual([root.dataset.theme, root.dataset.lang, root.lang], ["dark", "en", "en"]);
  applyPrefs(root, { lang: "xx", theme: "xx" });
  assert.deepEqual([root.dataset.theme, root.lang], ["light", "ta"]);
});

test("names are joined with the sentence's own language, not with an English and", () => {
  const ta = createI18n({ en: EN, ta: TA }, "ta");
  const en = createI18n({ en: EN, ta: TA }, "en");
  assert.equal(joinNames(["Priya S", "Suresh M"], ta.t), `Priya S ${TA["common.and"]} Suresh M`);
  assert.equal(joinNames(["Priya S", "Suresh M"], en.t), "Priya S and Suresh M");
  assert.equal(joinNames(["A", "B", "C"], en.t), "A, B and C");
  assert.equal(joinNames(["A", "B", "C"], ta.t), `A, B ${TA["common.and"]} C`);
});

test("one name needs no joining word, and no names give no text at all", () => {
  const en = createI18n({ en: EN, ta: TA }, "en");
  assert.equal(joinNames(["Priya S"], en.t), "Priya S");
  assert.equal(joinNames([], en.t), "");
  assert.equal(joinNames(["", null, "Priya S"], en.t), "Priya S");
});

test("every save state the form can show has wording in both languages", () => {
  for (const state of ["pending", "saving", "saved", "error", "conflict"]) {
    const key = saveStatusKey(state);
    assert.ok(EN[key], `${state} has no English wording (${key})`);
    assert.ok(TA[key], `${state} has no Tamil wording (${key})`);
  }
});

test("only a real network failure blames the network", () => {
  // A version conflict is someone else's save, not a bad connection. Checking Wi-Fi
  // cannot clear it, so neither language may send the person to look at their Wi-Fi.
  assert.match(EN[saveStatusKey("error")], /Wi-Fi/);
  assert.doesNotMatch(EN[saveStatusKey("conflict")], /Wi-Fi/);
  assert.doesNotMatch(TA[saveStatusKey("conflict")], /Wi-Fi/);
});

test("every consented field can be named to the person in both languages", () => {
  const SC_Consent = require("../../shared/consent.js");
  for (const id of SC_Consent.FIELDS) {
    const key = `sign.field.${id}`;
    assert.ok(EN[key], `${id} has no English name (${key})`);
    assert.ok(TA[key], `${id} has no Tamil name (${key})`);
  }
});

test("the stale-signature sentences say what changed", () => {
  assert.match(EN["sign.changedOne"], /\{field\}/);
  assert.match(EN["sign.changedMany"], /\{fields\}/);
  assert.match(TA["sign.changedOne"], /\{field\}/);
  assert.match(TA["sign.changedMany"], /\{fields\}/);
});
