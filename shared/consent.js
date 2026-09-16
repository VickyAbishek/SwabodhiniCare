// scope: shared
/* What the parent's signature covers (main spec §6 step 11, DPDP Act 2023).

   The consent statement is a permission to KEEP the applicant's data, not a claim that the
   clinical answers are right — so correcting a medicine must not stale a signature, while
   changing who the data is about, who gave the permission, or what they agreed to must.

   Pure, and it deliberately does not hash: check-scope.mjs keeps platform APIs out of shared/,
   and hashing needs SC_Crypto on Apps Script and crypto.subtle in the browser. Both sides hash
   this one payload, so a fingerprint taken on either side means the same thing. */
var SC_Consent = (function () {
  "use strict";

  var FIELDS = Object.freeze([
    "s11_consent",       // the statement agreed to
    "s11_parent_name",   // who gave the permission
    "s11_relationship",  // the authority they gave it under
    "s2_full_name",      // who the data is about
    "s2_dob",            // identity, and the basis for parental consent at all
  ]);

  // s11_signature is deliberately absent: its value is the attachment id, so including it would
  // make the fingerprint depend on the act of signing and no signature could match its own payload.

  // Empty and missing are the same thing, as SC_Applications.formValues already treats them, so a
  // field cleared and a field never filled cannot produce two different fingerprints.
  function payload(values) {
    var source = values || {};
    var out = {};
    FIELDS.forEach(function (id) {
      var value = source[id];
      var empty = value === null || value === undefined || value === "" || value === false;
      if (!empty) out[id] = value;
    });
    return JSON.stringify(out);
  }

  return Object.freeze({ FIELDS: FIELDS, payload: payload });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Consent;
}
