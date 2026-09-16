const { test } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../shared/form-schema.js");
const N = require("../../shared/numbers.js");

const TYPES = ["text", "textarea", "phone", "pincode", "date", "number", "choice", "multi", "file", "signature", "consent"];
const REQUIRED = [
  "s1_centre", "s1_enquiry_date", "s2_full_name", "s2_dob", "s2_gender", "s3_primary_contact",
  "s3_primary_phone", "s3_address", "s4_asd_diagnosed", "s10_observation", "s10_suitability",
  "s10_recommended_programs", "s11_consent", "s11_parent_name", "s11_relationship", "s11_signature",
];

test("there are 11 steps, s1 to s11, in order", () => {
  assert.deepEqual(F.STEPS.map((s) => s.id), ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"]);
  assert.ok(Number.isInteger(F.VERSION) && F.VERSION >= 1);
});

test("every step and question has English and Tamil text", () => {
  for (const step of F.STEPS) {
    assert.ok(step.en.trim() && step.ta.trim(), step.id);
    for (const field of step.fields) assert.ok(field.en.trim() && field.ta.trim(), field.id);
  }
});

test("field ids are unique, column-safe and prefixed by their step", () => {
  const ids = F.allFields().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of F.STEPS) {
    for (const field of step.fields) {
      assert.match(field.id, /^s(1[01]|[1-9])_[a-z0-9_]+$/);
      assert.ok(field.id.startsWith(step.id + "_"), field.id + " belongs to " + step.id);
    }
  }
});

test("every question uses a known type and the settings its type needs", () => {
  for (const field of F.allFields()) {
    assert.ok(TYPES.includes(field.type), field.id + " type " + field.type);
    if (field.type === "choice" || field.type === "multi") assert.ok(F.OPTIONS[field.options], field.id + " options");
    if (field.type === "number") assert.ok(typeof field.min === "number" && typeof field.max === "number", field.id + " min/max");
    if (field.type === "file") assert.ok(field.kind && field.maxFiles >= 1, field.id + " kind/maxFiles");
  }
});

test("answer lists have unique upper-case values with English and Tamil text", () => {
  for (const [name, list] of Object.entries(F.OPTIONS)) {
    const values = list.map((o) => o.value);
    assert.equal(new Set(values).size, values.length, name + " values unique");
    for (const o of list) {
      assert.match(o.value, /^[A-Z][A-Z0-9_]*$/, name + "." + o.value);
      assert.ok(o.en.trim() && o.ta.trim(), name + "." + o.value + " text");
    }
  }
});

test("centre answers match the registration-number centre codes", () => {
  assert.deepEqual(F.OPTIONS.CENTRE.map((o) => o.value), [...N.CENTRE_CODES]);
});

test("the program list matches the school's ten programs", () => {
  assert.equal(F.OPTIONS.PROGRAMS.length, 10);
  assert.ok(F.OPTIONS.PROGRAMS.some((o) => o.value === "ASSISTED_EMPLOYMENT"));
});

test("exactly the spec's required questions are required", () => {
  const required = F.allFields().filter((f) => f.required).map((f) => f.id);
  assert.deepEqual(required.sort(), [...REQUIRED].sort());
});

test("show-if rules point at an earlier, always-shown question", () => {
  const ids = F.allFields().map((f) => f.id);
  for (const field of F.allFields()) {
    const rule = field.showIf;
    if (!rule || rule.minAge !== undefined) continue;
    const target = F.fieldById(rule.field);
    assert.ok(target, field.id + " depends on a real question");
    assert.ok(ids.indexOf(rule.field) < ids.indexOf(field.id), field.id + " depends on an earlier question");
    assert.equal(target.showIf, undefined, field.id + " must not depend on a question that is itself hidden");
  }
});

test("there is no Aadhaar number question", () => {
  assert.ok(!F.allFields().some((f) => /aadhaar/.test(f.id) && f.type !== "choice"));
});

test("lookups find questions, steps and answer labels", () => {
  assert.equal(F.fieldById("s2_full_name").type, "text");
  assert.equal(F.fieldById("nope"), null);
  assert.equal(F.stepById("s6").en, "Current abilities");
  assert.equal(F.stepById("s12"), null);
  assert.equal(F.optionLabel("ABILITY", "WITH_HELP", "en"), "With help");
  assert.equal(F.optionLabel("ABILITY", "WITH_HELP", "ta"), "உதவியுடன்");
  assert.equal(F.optionLabel("ABILITY", "NOPE", "en"), null);
});

test("the schema cannot be changed at runtime", () => {
  assert.ok(Object.isFrozen(F.STEPS));
  assert.ok(Object.isFrozen(F.STEPS[1].fields[0]));
  assert.ok(Object.isFrozen(F.OPTIONS.CENTRE[0]));
  assert.ok(Object.isFrozen(F.allFields()));
});
