// SwabodhiniCare mockups — language switch, tap choices, show/hide password.
// Mockup-only behaviour; no data leaves the page.
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "sc-mock-lang";

  function setLang(lang) {
    var next = lang === "ta" ? "ta" : "en";
    root.dataset.lang = next;
    root.lang = next;
    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.setLang === next));
    });
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* storage unavailable: keep in-memory choice */ }
  }

  var initial = "en";
  try { initial = localStorage.getItem(STORAGE_KEY) || "en"; } catch (e) { /* ignore */ }
  setLang(initial);

  document.addEventListener("click", function (event) {
    var target = event.target;

    var langBtn = target.closest("[data-set-lang]");
    if (langBtn) { setLang(langBtn.dataset.setLang); return; }

    if (target.closest("[data-toggle-lang]")) {
      setLang(root.dataset.lang === "ta" ? "en" : "ta");
      return;
    }

    var showBtn = target.closest("[data-show-pw]");
    if (showBtn) {
      var input = document.getElementById(showBtn.dataset.showPw);
      if (input) {
        var reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        showBtn.setAttribute("aria-pressed", String(reveal));
      }
      return;
    }

    var choice = target.closest(".choice");
    if (choice) {
      var group = choice.closest(".choices");
      if (group) {
        group.querySelectorAll(".choice").forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === choice));
        });
      }
      return;
    }

    var deadLink = target.closest('a[href="#"]');
    if (deadLink) event.preventDefault();
  });
})();
