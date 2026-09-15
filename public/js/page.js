// scope: shared
// Start-up shared by every screen: settings, server connection, screen text, theme,
// the demo banner, the language button and show/hide password buttons.
// Error texts come from shared/actions.js, loaded by each page as a classic script (SC_Actions).
import { CONFIG } from "./config.js";
import { loadTransport, createApi } from "./api.js";
import { createI18n, applyTranslations, loadDictionaries, errorText } from "./i18n.js";
import { readPrefs, savePrefs, applyPrefs } from "./prefs.js";

export const PAGES = Object.freeze({
  signIn: "index.html",
  setup: "setup.html",
  password: "password.html",
  home: "home.html",
  settings: "settings.html",
});

function deviceStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return { getItem: () => null, setItem() {}, removeItem() {} }; // storage blocked
  }
}

export function goTo(page) {
  window.location.assign(page);
}

function showDemoBanner(i18n) {
  if (!CONFIG.IS_DEMO || document.querySelector(".demo-banner")) return;
  const banner = document.createElement("div");
  banner.className = "demo-banner";
  banner.setAttribute("role", "note");
  banner.dataset.i18n = "demo.banner";
  banner.textContent = i18n.t("demo.banner");
  document.body.prepend(banner);
}

function wirePasswordToggles(state) {
  document.querySelectorAll("[data-show-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.showPassword);
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.setAttribute("aria-pressed", String(reveal));
      const label = button.querySelector("[data-i18n]");
      if (label) {
        label.dataset.i18n = reveal ? "common.hide" : "common.show";
        label.textContent = state.i18n.t(label.dataset.i18n);
      }
    });
  });
}

// Starts a screen. With requireSignIn, people without a session are sent to the sign-in screen.
export async function startPage({ requireSignIn = false } = {}) {
  const storage = deviceStorage();
  const fetchImpl = window.fetch.bind(window);
  const state = { prefs: readPrefs(storage), i18n: null };
  applyPrefs(document.documentElement, state.prefs);
  const dictionaries = await loadDictionaries(fetchImpl, "i18n");
  const transport = await loadTransport(CONFIG, { fetch: fetchImpl, storage });
  const api = createApi(transport, { onSignedOut: () => goTo(PAGES.signIn) });
  if (requireSignIn && !api.isSignedIn()) {
    goTo(PAGES.signIn);
    return null;
  }

  function render() {
    state.i18n = createI18n(dictionaries, state.prefs.lang);
    applyPrefs(document.documentElement, state.prefs);
    applyTranslations(document, state.i18n);
    document.querySelectorAll("[data-set-lang]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.setLang === state.prefs.lang));
    });
    document.querySelectorAll("[data-set-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.setTheme === state.prefs.theme));
    });
  }

  function setPrefs(changes) {
    state.prefs = Object.assign({}, state.prefs, changes);
    savePrefs(storage, state.prefs);
    render();
  }

  render();
  showDemoBanner(state.i18n);
  wirePasswordToggles(state);
  // Big "தமிழ் / English" buttons (data-set-lang) and the app-bar switch (data-lang-toggle).
  document.querySelectorAll("[data-set-lang]").forEach((button) => {
    button.addEventListener("click", () => setPrefs({ lang: button.dataset.setLang }));
  });
  document.querySelectorAll("[data-lang-toggle]").forEach((button) => {
    button.addEventListener("click", () => setPrefs({ lang: state.prefs.lang === "ta" ? "en" : "ta" }));
  });

  return {
    api,
    t: (key, vars) => state.i18n.t(key, vars),
    prefs: () => state.prefs,
    setPrefs,
    errorMessage: (error) => errorText(error, state.prefs.lang, window.SC_Actions.ERRORS),
  };
}

// Shows or clears a message box (role="alert" in the HTML, so screen readers announce it).
export function showMessage(box, text, kind = "bad") {
  box.textContent = text || "";
  box.className = `alert alert-${kind}`;
  box.hidden = !text;
}

// Disables a button while work is in progress and swaps its label.
export function setBusy(button, busyText, busy) {
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.idleText) {
    button.textContent = button.dataset.idleText;
  }
  button.disabled = busy;
}
