// scope: shared
/* Date helpers on plain "YYYY-MM-DD" strings, so no time zone can shift a date. */
var SC_Dates = (function () {
  "use strict";

  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_MS = 86400000;

  function isValidDateParts(year, month, day) {
    if (![year, month, day].every(Number.isInteger)) return false;
    if (month < 1 || month > 12 || day < 1) return false;
    var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= daysInMonth;
  }

  function parseIsoDate(text) {
    var match = ISO_DATE.exec(String(text));
    if (!match) throw new RangeError("Expected a date like 2020-03-14, got " + text);
    var parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (!isValidDateParts(parts.year, parts.month, parts.day)) {
      throw new RangeError("Not a real calendar date: " + text);
    }
    return parts;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIsoDate(year, month, day) {
    if (!isValidDateParts(year, month, day)) {
      throw new RangeError("Not a real calendar date: " + [year, month, day].join("-"));
    }
    return year + "-" + pad2(month) + "-" + pad2(day);
  }

  function ageFrom(dobIso, onIso) {
    var dob = parseIsoDate(dobIso);
    var on = parseIsoDate(onIso);
    var months = (on.year - dob.year) * 12 + (on.month - dob.month);
    if (on.day < dob.day) months -= 1;
    if (months < 0) throw new RangeError("Date of birth " + dobIso + " is after " + onIso);
    return { years: Math.floor(months / 12), months: months % 12 };
  }

  function daysBetween(fromIso, toIso) {
    var a = parseIsoDate(fromIso);
    var b = parseIsoDate(toIso);
    var diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
    return Math.round(diff / DAY_MS);
  }

  return Object.freeze({
    isValidDateParts: isValidDateParts,
    parseIsoDate: parseIsoDate,
    toIsoDate: toIsoDate,
    ageFrom: ageFrom,
    daysBetween: daysBetween,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Dates;
}
