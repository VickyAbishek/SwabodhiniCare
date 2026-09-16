// scope: shared
// Language and light/dark, remembered on this device (main spec §12, D23). Tamil and light are the
// defaults. The account's saved choice (users.preferred_*) is applied again after sign-in.
// theme-boot.js reads the same two keys before the page draws; keep them in step.
const KEYS = Object.freeze({ lang: "sc-lang", theme: "sc-theme" });
const ALLOWED = Object.freeze({ lang: ["ta", "en"], theme: ["light", "dark"] });
const DEFAULTS = Object.freeze({ lang: "ta", theme: "light" });

function pick(name, value) {
  return ALLOWED[name].includes(value) ? value : DEFAULTS[name];
}

export function readPrefs(storage) {
  const read = (name) => {
    try {
      return storage.getItem(KEYS[name]);
    } catch (err) {
      return null; // storage blocked: use the defaults
    }
  };
  return { lang: pick("lang", read("lang")), theme: pick("theme", read("theme")) };
}

export function savePrefs(storage, prefs) {
  Object.keys(KEYS).forEach((name) => {
    if (!ALLOWED[name].includes(prefs[name])) return;
    try {
      storage.setItem(KEYS[name], prefs[name]);
    } catch (err) {
      // storage blocked: the account still keeps the setting
    }
  });
}

export function applyPrefs(root, prefs) {
  const lang = pick("lang", prefs.lang);
  root.dataset.theme = pick("theme", prefs.theme);
  root.dataset.lang = lang;
  root.lang = lang;
}
