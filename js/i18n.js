// SE2L-81: shared i18n loader, included on every converted page (after
// its lang/en.js — or later, whichever language dictionaries are loaded
// — and before that page's own script).
//
// Two jobs:
//   1. Walks the DOM once and replaces text/placeholders/aria-labels on
//      any element tagged with data-i18n / data-i18n-placeholder /
//      data-i18n-aria-label, using the active language's dictionary.
//   2. Exposes window.t(key) so each page's own JS can translate strings
//      it generates dynamically (alert messages, template-literal
//      content in rendered lists, etc.) rather than only static HTML.
//
// SE2L-83: the active language is now selectable — see
// se2lGetActiveLanguage()/window.se2lSetLanguage() below. Adding a new
// language still only requires a new lang/xx.js dictionary (loaded
// before this file) plus adding it to the language <select> options
// where relevant; this file's mechanism doesn't need to change.

// SE2L-83: the active language now comes from localStorage (set by the
// language <select> on onboarding/invite pages, or the language switcher
// on settings.html), falling back to English if nothing's been chosen
// yet or the stored value doesn't have a loaded dictionary. Using
// localStorage rather than a fresh Supabase profile fetch on every page
// load keeps this fast and avoids needing to touch every page's own JS
// just to read profile.language.
function se2lGetActiveLanguage() {
  const stored = localStorage.getItem("se2l_language");
  if (stored && window.SE2L_LANG_DICTS && window.SE2L_LANG_DICTS[stored]) {
    return stored;
  }
  return "en";
}

let se2lActiveDict = null;
let se2lActiveLanguage = "en";

// Translates everything data-i18n-tagged within a given subtree. Exposed
// globally so any page's JS can call this after inserting new dynamic
// content — e.g. a cloned <template>, or a freshly-rendered list — since
// that content didn't exist yet when the initial page-load pass ran.
function se2lTranslateElement(root) {
  if (!se2lActiveDict) return;

  root.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (se2lActiveDict[key] !== undefined) {
      el.textContent = se2lActiveDict[key];
    }
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (se2lActiveDict[key] !== undefined) {
      el.setAttribute("placeholder", se2lActiveDict[key]);
    }
  });

  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria-label");
    if (se2lActiveDict[key] !== undefined) {
      el.setAttribute("aria-label", se2lActiveDict[key]);
    }
  });
}

function se2lApplyTranslations(dict, lang) {
  se2lActiveDict = dict;
  se2lActiveLanguage = lang || "en";

  // Arabic and Urdu are right-to-left languages — set the document
  // direction so the browser mirrors layout correctly. This alone
  // doesn't fix everything (some custom flex/spacing still needs
  // direction-aware CSS), but it's the essential base-level switch.
  const rtlLanguages = ["ar", "ur"];
  document.documentElement.dir = rtlLanguages.includes(se2lActiveLanguage) ? "rtl" : "ltr";
  document.documentElement.lang = se2lActiveLanguage;

  se2lTranslateElement(document);

  // Global lookup for each page's own JS. Supports optional {placeholder}
  // interpolation for dynamic values (counts, names) — e.g.
  // t("dashboard.task_count", {completed: 3, total: 8}) with a dictionary
  // entry like "{completed} of {total} complete". Falls back to returning
  // the key itself if it's not in the dictionary, so a missing translation
  // is visibly obvious (shows "some.key" on screen) rather than silently
  // blank.
  window.t = function (key, vars) {
    let str = dict[key] !== undefined ? dict[key] : key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
      });
    }
    return str;
  };

  // Exposed so a page can re-translate a specific subtree after inserting
  // new dynamic content — see the comment on se2lTranslateElement above.
  window.se2lTranslateElement = se2lTranslateElement;

  document.dispatchEvent(new CustomEvent("se2l:translations-ready"));
}

function se2lLoadTranslations() {
  const lang = se2lGetActiveLanguage();
  const dict = window.SE2L_LANG_DICTS && window.SE2L_LANG_DICTS[lang];

  if (!dict) {
    console.warn(`i18n: no dictionary loaded for language "${lang}" — check that lang/${lang}.js is included before i18n.js.`);
    window.t = (key) => key;
    return;
  }

  se2lApplyTranslations(dict, lang);
}

// Exposed so settings.html's language switcher (and the onboarding/invite
// page language selects) can change the active language immediately
// without a full page reload, and so future page loads pick up the
// stored choice via se2lGetActiveLanguage() above.
window.se2lSetLanguage = function (lang) {
  if (!window.SE2L_LANG_DICTS || !window.SE2L_LANG_DICTS[lang]) {
    console.warn(`i18n: cannot switch to "${lang}" — no dictionary loaded for it.`);
    return;
  }
  localStorage.setItem("se2l_language", lang);
  se2lApplyTranslations(window.SE2L_LANG_DICTS[lang], lang);
};

se2lLoadTranslations();