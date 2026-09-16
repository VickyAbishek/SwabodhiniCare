// scope: shared
/* Form behaviour on top of form-schema.js: which questions show, answer checks, progress,
   safety flags and summary columns. Pure functions; inputs are never changed. */
var SC_FormRules = (function () {
  "use strict";

  // Globals in the browser and Apps Script; sibling files in Node tests.
  function schema() {
    return typeof SC_FormSchema !== "undefined" ? SC_FormSchema : require("./form-schema.js");
  }

  function dates() {
    return typeof SC_Dates !== "undefined" ? SC_Dates : require("./dates.js");
  }

  var FIELD_ERRORS = Object.freeze({
    REQUIRED: Object.freeze({ en: "Please answer this question.", ta: "இந்தக் கேள்விக்குப் பதிலளிக்கவும்." }),
    TOO_LONG: Object.freeze({ en: "This answer is too long. Please shorten it.", ta: "இந்தப் பதில் மிக நீளமாக உள்ளது. சுருக்கவும்." }),
    INVALID_VALUE: Object.freeze({ en: "This answer isn't in the right form. Please enter it again.", ta: "இந்தப் பதில் சரியான வடிவில் இல்லை. மீண்டும் உள்ளிடவும்." }),
    CONSENT_STALE: Object.freeze({ en: "The details changed after the parent signed. Please take the signature again.", ta: "பெற்றோர் கையொப்பமிட்ட பிறகு விவரங்கள் மாறியுள்ளன. கையொப்பத்தை மீண்டும் பெறவும்." }),
    INVALID_PHONE: Object.freeze({ en: "Enter the phone number with 10 digits.", ta: "10 இலக்கத் தொலைபேசி எண்ணை உள்ளிடவும்." }),
    INVALID_PINCODE: Object.freeze({ en: "Enter the 6-digit pincode.", ta: "6 இலக்க அஞ்சல் குறியீட்டை உள்ளிடவும்." }),
    INVALID_DATE: Object.freeze({ en: "Choose a real date.", ta: "சரியான தேதியைத் தேர்ந்தெடுக்கவும்." }),
    DATE_IN_FUTURE: Object.freeze({ en: "This date can't be in the future.", ta: "இந்தத் தேதி எதிர்காலத்தில் இருக்கக் கூடாது." }),
    INVALID_NUMBER: Object.freeze({ en: "Enter a number.", ta: "ஒரு எண்ணை உள்ளிடவும்." }),
    OUT_OF_RANGE: Object.freeze({ en: "This number is outside the allowed range.", ta: "இந்த எண் அனுமதிக்கப்பட்ட வரம்பிற்கு வெளியே உள்ளது." }),
    INVALID_OPTION: Object.freeze({ en: "Choose one of the options shown.", ta: "காட்டப்பட்டுள்ள விருப்பங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்." }),
    TOO_MANY_FILES: Object.freeze({ en: "Too many files. Remove one first.", ta: "கோப்புகள் அதிகம். முதலில் ஒன்றை நீக்கவும்." }),
    UNKNOWN_FIELD: Object.freeze({ en: "This answer isn't part of the form.", ta: "இந்தப் பதில் படிவத்தின் பகுதி அல்ல." }),
  });

  var TEXT_LIMIT = Object.freeze({ text: 120, textarea: 2000 });
  var PHONE = /^[6-9]\d{9}$/;
  var PINCODE = /^[1-9]\d{5}$/;
  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isRealIsoDate(text) {
    var match = typeof text === "string" ? ISO_DATE.exec(text) : null;
    return Boolean(match) && dates().isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  function isEmpty(field, value) {
    if (value === undefined || value === null) return true;
    if (field.type === "consent") return value === false;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  function ageInYears(dob, today) {
    if (!isRealIsoDate(dob) || dob > today) return null;
    return dates().ageFrom(dob, today).years;
  }

  function isVisible(field, values, today) {
    var rule = field.showIf;
    if (!rule) return true;
    if (rule.minAge !== undefined) {
      var age = ageInYears(values.s2_dob, today);
      return age !== null && age >= rule.minAge;
    }
    var value = values[rule.field];
    if (rule.equals !== undefined) return [].concat(rule.equals).indexOf(value) !== -1;
    if (rule.includes !== undefined) return Array.isArray(value) && value.indexOf(rule.includes) !== -1;
    if (rule.filled) return !isEmpty(schema().fieldById(rule.field), value);
    if (rule.greaterThan !== undefined) return typeof value === "number" && value > rule.greaterThan;
    throw new Error("Unknown show-if rule on " + field.id);
  }

  function optionValues(field) {
    return schema().OPTIONS[field.options].map(function (o) { return o.value; });
  }

  function checkText(field, value) {
    if (typeof value !== "string") return "INVALID_VALUE";
    return value.length > (field.maxLength || TEXT_LIMIT[field.type]) ? "TOO_LONG" : null;
  }

  function checkNumber(field, value) {
    if (typeof value !== "number" || !isFinite(value)) return "INVALID_NUMBER";
    if (!field.decimals && !Number.isInteger(value)) return "INVALID_NUMBER";
    return value < field.min || value > field.max ? "OUT_OF_RANGE" : null;
  }

  function checkMulti(field, value) {
    if (!Array.isArray(value)) return "INVALID_OPTION";
    var allowed = optionValues(field);
    var bad = value.some(function (v, i) {
      return allowed.indexOf(v) === -1 || value.indexOf(v) !== i;
    });
    return bad ? "INVALID_OPTION" : null;
  }

  function checkFiles(field, value) {
    var shapeOk = Array.isArray(value) && value.every(function (id) { return typeof id === "string" && id !== ""; });
    if (!shapeOk) return "INVALID_VALUE";
    return value.length > field.maxFiles ? "TOO_MANY_FILES" : null;
  }

  var CHECKS = Object.freeze({
    text: checkText,
    textarea: checkText,
    phone: function (f, v) { return typeof v === "string" && PHONE.test(v) ? null : "INVALID_PHONE"; },
    pincode: function (f, v) { return typeof v === "string" && PINCODE.test(v) ? null : "INVALID_PINCODE"; },
    date: function (f, v, today) {
      if (!isRealIsoDate(v)) return "INVALID_DATE";
      return f.noFuture && v > today ? "DATE_IN_FUTURE" : null;
    },
    number: checkNumber,
    choice: function (f, v) { return optionValues(f).indexOf(v) === -1 ? "INVALID_OPTION" : null; },
    multi: checkMulti,
    file: checkFiles,
    signature: function (f, v) { return typeof v === "string" && v !== "" ? null : "INVALID_VALUE"; },
    consent: function (f, v) { return typeof v === "boolean" ? null : "INVALID_VALUE"; },
  });

  // Returns an error code for one visible question, or null.
  function fieldError(field, value, mode, today) {
    if (isEmpty(field, value)) return mode === "submit" && field.required ? "REQUIRED" : null;
    return CHECKS[field.type](field, value, today);
  }

  function validate(values, options) {
    var mode = options && options.mode;
    if (mode !== "draft" && mode !== "submit") throw new TypeError('mode must be "draft" or "submit"');
    var today = options.today;
    dates().parseIsoDate(today);
    var errors = {};
    Object.keys(values).forEach(function (key) {
      if (!schema().fieldById(key)) errors[key] = "UNKNOWN_FIELD";
    });
    schema().allFields().forEach(function (field) {
      if (!isVisible(field, values, today)) return;
      var code = fieldError(field, values[field.id], mode, today);
      if (code) errors[field.id] = code;
    });
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  function stepState(step, values, today) {
    var visible = step.fields.filter(function (f) { return isVisible(f, values, today); });
    var answered = visible.some(function (f) { return !isEmpty(f, values[f.id]); });
    if (!answered) return "empty";
    var problem = visible.some(function (f) { return fieldError(f, values[f.id], "submit", today) !== null; });
    return problem ? "incomplete" : "done";
  }

  function completion(values, today) {
    var steps = {};
    var done = 0;
    schema().STEPS.forEach(function (step) {
      steps[step.id] = stepState(step, values, today);
      if (steps[step.id] === "done") done += 1;
    });
    return { done: done, total: schema().STEPS.length, steps: steps };
  }

  function safetyFlags(values) {
    return schema().allFields()
      .filter(function (f) { return f.safety && values[f.id] === "OFTEN"; })
      .map(function (f) { return f.id; });
  }

  function summarize(values) {
    var programs = values.s10_recommended_programs;
    return {
      centre: values.s1_centre || null,
      applicantName: typeof values.s2_full_name === "string" ? values.s2_full_name.trim() : "",
      dob: values.s2_dob || null,
      gender: values.s2_gender || null,
      suitability: values.s10_suitability || null,
      programs: Array.isArray(programs) ? programs.slice() : [],
    };
  }

  return Object.freeze({
    FIELD_ERRORS: FIELD_ERRORS,
    isEmpty: isEmpty,
    isVisible: isVisible,
    validate: validate,
    completion: completion,
    safetyFlags: safetyFlags,
    summarize: summarize,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_FormRules;
}
