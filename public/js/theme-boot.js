// scope: shared
// Loaded in <head> (not as a module) so the saved theme and language apply before the page draws,
// with no flash of the wrong colours. Light and Tamil are the defaults. Keep in step with prefs.js.
(function () {
  "use strict";
  var root = document.documentElement;
  var theme = "light";
  var lang = "ta";
  try {
    if (localStorage.getItem("sc-theme") === "dark") theme = "dark";
    if (localStorage.getItem("sc-lang") === "en") lang = "en";
  } catch (err) {
    // storage blocked: keep the defaults
  }
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-lang", lang);
  root.setAttribute("lang", lang);
})();
