import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SAMPLE_APPLICANT } from "../../public/js/seed/sample-applications.js";

const require = createRequire(import.meta.url);
const schema = require("../../shared/form-schema.js");
const rules = require("../../shared/form-rules.js");

const TODAY = "2026-09-15";
// Photos and signatures wait for uploads (M7). A required one can never be answered now, so a
// demo may leave those blank; nothing else may be left blank.
const blockingFields = () =>
  schema.allFields()
    .filter((f) => ["file", "signature"].includes(f.type) && f.required && rules.isVisible(f, SAMPLE_APPLICANT, TODAY))
    .map((f) => f.id);

test("the sample applicant answers every question that does not wait for uploads", () => {
  const blocking = blockingFields();
  const result = rules.validate(SAMPLE_APPLICANT, { mode: "submit", today: TODAY });
  const unanswered = Object.keys(result.errors).filter((id) => !blocking.includes(id));
  assert.deepEqual(unanswered, [], `unanswered or wrong: ${JSON.stringify(result.errors)}`);
});

test("the only step left unfinished is the one holding the signature", () => {
  const blocking = blockingFields();
  const progress = rules.completion(SAMPLE_APPLICANT, TODAY);
  const short = schema.STEPS.filter((step) => progress.steps[step.id] !== "done");
  short.forEach((step) => {
    assert.ok(
      step.fields.some((field) => blocking.includes(field.id)),
      `step ${step.id} is unfinished but holds nothing that waits for uploads`,
    );
  });
  assert.ok(short.length > 0, "the consent step should still be waiting for the signature");
});

test("the sample applicant is a child, so the adult questions stay hidden", () => {
  const adult = schema.allFields().filter((f) => f.showIf && f.showIf.minAge !== undefined);
  assert.ok(adult.length > 0, "the schema should have an age-gated question for this test to mean anything");
  adult.forEach((field) => {
    assert.equal(rules.isVisible(field, SAMPLE_APPLICANT, TODAY), false, `${field.id} is meant for adults`);
  });
});

test("the sample answers are frozen, so filling the form cannot change them", () => {
  assert.ok(Object.isFrozen(SAMPLE_APPLICANT));
});
