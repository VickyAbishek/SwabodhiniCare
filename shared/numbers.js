// scope: shared
/* Application and registration number formats (main spec §5, scope map F13). */
var SC_Numbers = (function () {
  "use strict";

  var CENTRE_CODES = Object.freeze(["TVM", "VLC", "TDP", "SLR"]);

  function pad4(seq) {
    if (!Number.isInteger(seq) || seq < 1 || seq > 9999) {
      throw new RangeError("Sequence must be a whole number from 1 to 9999, got " + seq);
    }
    return String(seq).padStart(4, "0");
  }

  function checkYear(year) {
    if (!Number.isInteger(year) || year < 2000 || year > 2999) {
      throw new RangeError("Year must be a four-digit number, got " + year);
    }
  }

  function formatAppNo(year, seq) {
    checkYear(year);
    return "APP-" + year + "-" + pad4(seq);
  }

  function formatRegNo(centreCode, year, seq) {
    if (CENTRE_CODES.indexOf(centreCode) === -1) {
      throw new RangeError("Unknown centre code: " + centreCode);
    }
    checkYear(year);
    return "SWB/" + centreCode + "/" + year + "/" + pad4(seq);
  }

  return Object.freeze({ CENTRE_CODES: CENTRE_CODES, formatAppNo: formatAppNo, formatRegNo: formatRegNo });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Numbers;
}
