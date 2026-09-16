import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SC_Consent = require("../../shared/consent.js");

const signed = {
  s2_full_name: "Kavya Selvam",
  s2_dob: "2025-11-16",
  s11_consent: true,
  s11_parent_name: "Selvam R",
  s11_relationship: "FATHER",
  s4_current_medicines: "None",
  s11_signature: "att-1",
};

test("the consent covers five fields, in a fixed order", () => {
  assert.deepEqual(SC_Consent.FIELDS, [
    "s11_consent", "s11_parent_name", "s11_relationship", "s2_full_name", "s2_dob",
  ]);
  assert.ok(Object.isFrozen(SC_Consent.FIELDS));
});

test("a change to any consented fact changes the payload", () => {
  const before = SC_Consent.payload(signed);
  for (const field of SC_Consent.FIELDS) {
    const after = SC_Consent.payload({ ...signed, [field]: "something else" });
    assert.notEqual(after, before, field);
  }
});

test("a change to anything else leaves the payload alone", () => {
  const before = SC_Consent.payload(signed);
  // A medicine corrected, a note added, and the signature itself replaced: none of these is
  // something the parent agreed to, so none may stale their signature.
  assert.equal(SC_Consent.payload({ ...signed, s4_current_medicines: "Risperidone" }), before);
  assert.equal(SC_Consent.payload({ ...signed, s5_notes: "added later" }), before);
  assert.equal(SC_Consent.payload({ ...signed, s11_signature: "att-2" }), before);
});

test("an answer cleared and an answer never given are the same thing", () => {
  // Otherwise clearing a field and never filling it would fingerprint differently, and a
  // signature would go stale over a distinction the parent cannot see.
  const { s11_parent_name, ...noParent } = signed;
  assert.equal(SC_Consent.payload({ ...signed, s11_parent_name: "" }), SC_Consent.payload(noParent));

  const { s11_consent, ...noConsent } = signed;
  assert.equal(SC_Consent.payload({ ...signed, s11_consent: false }), SC_Consent.payload(noConsent));
});

test("key order does not depend on the caller's object", () => {
  const reversed = {
    s2_dob: signed.s2_dob, s2_full_name: signed.s2_full_name,
    s11_relationship: signed.s11_relationship, s11_parent_name: signed.s11_parent_name,
    s11_consent: signed.s11_consent,
  };
  assert.equal(SC_Consent.payload(reversed), SC_Consent.payload(signed));
});

test("no values at all is a payload, not a crash", () => {
  assert.equal(SC_Consent.payload({}), SC_Consent.payload(undefined));
});
