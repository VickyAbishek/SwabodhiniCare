const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../shared/form-rules.js");
const F = require("../../shared/form-schema.js");
const SAMPLE = require("../fixtures/sample-application.js");

const TODAY = "2026-09-15";
const field = (id) => F.fieldById(id);
const draft = (values) => R.validate(values, { mode: "draft", today: TODAY });
const submit = (values) => R.validate(values, { mode: "submit", today: TODAY });
const withValues = (extra) => Object.assign({}, SAMPLE, extra);

test("the complete sample passes submit checks", () => {
  assert.deepEqual(submit(SAMPLE), { ok: true, errors: {} });
});

test("an empty draft is fine; an empty submission lists every required question", () => {
  assert.deepEqual(draft({}), { ok: true, errors: {} });
  const result = submit({});
  assert.equal(result.ok, false);
  const required = F.allFields().filter((f) => f.required).map((f) => f.id).sort();
  assert.deepEqual(Object.keys(result.errors).sort(), required);
  assert.ok(Object.values(result.errors).every((code) => code === "REQUIRED"));
});

test("drafts still check the format of answers that were given", () => {
  assert.equal(draft({ s3_primary_phone: "12345" }).errors.s3_primary_phone, "INVALID_PHONE");
  assert.equal(draft({ s3_pincode: "60004" }).errors.s3_pincode, "INVALID_PINCODE");
  assert.equal(draft({ s2_full_name: "x".repeat(121) }).errors.s2_full_name, "TOO_LONG");
  assert.equal(draft({ s3_address: "x".repeat(2001) }).errors.s3_address, "TOO_LONG");
  assert.equal(draft({ s2_full_name: 42 }).errors.s2_full_name, "INVALID_VALUE");
});

test("dates must be real and, where marked, not in the future", () => {
  assert.equal(draft({ s2_dob: "2026-02-30" }).errors.s2_dob, "INVALID_DATE");
  assert.equal(draft({ s2_dob: "14/03/2020" }).errors.s2_dob, "INVALID_DATE");
  assert.equal(draft({ s2_dob: "2026-09-16" }).errors.s2_dob, "DATE_IN_FUTURE");
  assert.equal(draft({ s2_dob: TODAY }).ok, true);
});

test("numbers must be numbers inside their range; whole numbers unless decimals are allowed", () => {
  assert.equal(draft({ s3_siblings: "2" }).errors.s3_siblings, "INVALID_NUMBER");
  assert.equal(draft({ s3_siblings: 1.5 }).errors.s3_siblings, "INVALID_NUMBER");
  assert.equal(draft({ s3_siblings: 16 }).errors.s3_siblings, "OUT_OF_RANGE");
  assert.equal(draft({ s5_birth_weight: 2.9 }).ok, true);
  assert.equal(draft({ s5_birth_weight: Number.NaN }).errors.s5_birth_weight, "INVALID_NUMBER");
});

test("choices must come from the question's answer list", () => {
  assert.equal(draft({ s2_gender: "UNKNOWN" }).errors.s2_gender, "INVALID_OPTION");
  assert.equal(draft({ s1_programs: ["YOGA", "FLYING"] }).errors.s1_programs, "INVALID_OPTION");
  assert.equal(draft({ s1_programs: ["YOGA", "YOGA"] }).errors.s1_programs, "INVALID_OPTION");
  assert.equal(draft({ s1_programs: "YOGA" }).errors.s1_programs, "INVALID_OPTION");
});

test("files, signatures and consent have the right shape", () => {
  assert.equal(draft({ s2_photo: ["a", "b"] }).errors.s2_photo, "TOO_MANY_FILES");
  assert.equal(draft({ s2_photo: [""] }).errors.s2_photo, "INVALID_VALUE");
  assert.equal(draft({ s11_signature: 7 }).errors.s11_signature, "INVALID_VALUE");
  assert.equal(draft({ s11_consent: "yes" }).errors.s11_consent, "INVALID_VALUE");
  assert.equal(submit(withValues({ s11_consent: false })).errors.s11_consent, "REQUIRED");
});

test("answers to questions that are not on the form are rejected", () => {
  assert.equal(draft({ s2_aadhaar_number: "1234" }).errors.s2_aadhaar_number, "UNKNOWN_FIELD");
});

test("show-if: UDID number only when the card is held", () => {
  assert.equal(R.isVisible(field("s2_udid_number"), { s2_udid_status: "HAVE" }, TODAY), true);
  assert.equal(R.isVisible(field("s2_udid_number"), { s2_udid_status: "APPLIED" }, TODAY), false);
});

test("show-if: work experience only for applicants aged 18 or more", () => {
  const adult = { s2_dob: "2007-01-01" };
  assert.equal(R.isVisible(field("s8_work_experience"), adult, TODAY), true);
  assert.equal(R.isVisible(field("s8_work_experience"), { s2_dob: "2020-03-14" }, TODAY), false);
  assert.equal(R.isVisible(field("s8_work_experience"), {}, TODAY), false);
  assert.equal(R.isVisible(field("s8_work_experience"), { s2_dob: "2027-01-01" }, TODAY), false);
});

test("show-if: filled, includes, greater-than and any-of rules", () => {
  assert.equal(R.isVisible(field("s3_guardian_relation"), { s3_guardian_name: "Mala" }, TODAY), true);
  assert.equal(R.isVisible(field("s3_guardian_relation"), { s3_guardian_name: "  " }, TODAY), false);
  assert.equal(R.isVisible(field("s4_conditions_other"), { s4_conditions: ["OTHER"] }, TODAY), true);
  assert.equal(R.isVisible(field("s4_conditions_other"), { s4_conditions: ["ADHD"] }, TODAY), false);
  assert.equal(R.isVisible(field("s3_sibling_disability"), { s3_siblings: 2 }, TODAY), true);
  assert.equal(R.isVisible(field("s3_sibling_disability"), { s3_siblings: 0 }, TODAY), false);
  assert.equal(R.isVisible(field("s4_assessment_score"), { s4_assessment_tool: "ISAA" }, TODAY), true);
  assert.equal(R.isVisible(field("s4_assessment_score"), { s4_assessment_tool: "NONE" }, TODAY), false);
  assert.equal(R.isVisible(field("s2_full_name"), {}, TODAY), true);
});

test("hidden questions are not checked", () => {
  assert.equal(draft({ s2_udid_status: "NO", s2_udid_percent: 500 }).ok, true);
  assert.equal(draft({ s2_udid_status: "HAVE", s2_udid_percent: 500 }).errors.s2_udid_percent, "OUT_OF_RANGE");
});

test("isEmpty treats blank text, empty lists and unticked consent as empty", () => {
  assert.equal(R.isEmpty(field("s2_full_name"), "   "), true);
  assert.equal(R.isEmpty(field("s1_programs"), []), true);
  assert.equal(R.isEmpty(field("s11_consent"), false), true);
  assert.equal(R.isEmpty(field("s11_consent"), true), false);
  assert.equal(R.isEmpty(field("s3_siblings"), 0), false);
});

test("validate needs a mode and a real date for today", () => {
  assert.throws(() => R.validate({}, { mode: "final", today: TODAY }), TypeError);
  assert.throws(() => R.validate({}, { mode: "draft" }), RangeError);
});

test("validate does not change the answers it is given", () => {
  const frozen = Object.freeze({ s2_full_name: "Arjun" });
  assert.doesNotThrow(() => draft(frozen));
});

test("completion shows progress per step", () => {
  assert.deepEqual(R.completion(SAMPLE, TODAY), {
    done: 11,
    total: 11,
    steps: { s1: "done", s2: "done", s3: "done", s4: "done", s5: "done", s6: "done", s7: "done", s8: "done", s9: "done", s10: "done", s11: "done" },
  });
  const partial = R.completion({ s1_centre: "VLC", s2_full_name: "Arjun" }, TODAY);
  assert.equal(partial.done, 0);
  assert.equal(partial.steps.s1, "incomplete");
  assert.equal(partial.steps.s2, "incomplete");
  assert.equal(partial.steps.s5, "empty");
  assert.equal(R.completion({ s3_siblings: 20 }, TODAY).steps.s3, "incomplete");
});

test("safety flags come from safety questions answered Often", () => {
  assert.deepEqual(R.safetyFlags(SAMPLE), ["s7_wandering"]);
  assert.deepEqual(R.safetyFlags({ s7_self_injury: "OFTEN", s7_wandering: "OFTEN" }), ["s7_self_injury", "s7_wandering"]);
  assert.deepEqual(R.safetyFlags({ s7_aggression: "OFTEN" }), []);
});

test("summarize pulls out the columns used by lists and reports", () => {
  assert.deepEqual(R.summarize(SAMPLE), {
    centre: "VLC",
    applicantName: "Arjun Karthik",
    dob: "2020-03-14",
    gender: "MALE",
    suitability: "SUITABLE",
    programs: ["SPECIAL_EDUCATION", "SPEECH_THERAPY"],
  });
  assert.deepEqual(R.summarize({}), { centre: null, applicantName: "", dob: null, gender: null, suitability: null, programs: [] });
});

test("every error code has English and Tamil text", () => {
  for (const [code, msg] of Object.entries(R.FIELD_ERRORS)) {
    assert.ok(msg.en.trim() && msg.ta.trim(), code);
  }
  assert.ok(Object.isFrozen(R.FIELD_ERRORS));
});
