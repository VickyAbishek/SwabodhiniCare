import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFormView } from "../../public/js/form-view.js";

const require = createRequire(import.meta.url);
const view = createFormView({
  schema: require("../../shared/form-schema.js"),
  rules: require("../../shared/form-rules.js"),
  dates: require("../../shared/dates.js"),
});
const TODAY = "2026-09-15";
const field = (model, id) => model.fields.find((f) => f.id === id);

test("a step's model has the title and labels in the chosen language", () => {
  const ta = view.stepModel("s2", {}, TODAY, "ta");
  assert.equal(ta.title, "விண்ணப்பதாரர் விவரங்கள்");
  assert.equal(ta.number, 2);
  assert.equal(ta.total, 11);
  assert.equal(field(ta, "s2_full_name").label, "முழுப் பெயர்");
  assert.equal(field(ta, "s2_full_name").required, true);
  assert.equal(view.stepModel("s2", {}, TODAY, "en").title, "Applicant details");
});

test("questions that don't apply yet are left out", () => {
  const ids = (values) => view.stepModel("s2", values, TODAY, "en").fields.map((f) => f.id);
  assert.ok(!ids({}).includes("s2_udid_number"));
  assert.ok(ids({ s2_udid_status: "HAVE" }).includes("s2_udid_number"));
});

test("choice questions list their answers with the current one marked", () => {
  const gender = field(view.stepModel("s2", { s2_gender: "FEMALE" }, TODAY, "ta"), "s2_gender");
  assert.deepEqual(gender.options.map((o) => [o.value, o.label, o.selected]), [
    ["MALE", "ஆண்", false], ["FEMALE", "பெண்", true], ["OTHER", "மற்றவை", false],
  ]);
  const programs = field(view.stepModel("s1", { s1_programs: ["YOGA"] }, TODAY, "en"), "s1_programs");
  assert.equal(programs.options.find((o) => o.value === "YOGA").selected, true);
});

test("file questions carry their kind and maxFiles to the renderer", () => {
  const photo = field(view.stepModel("s2", {}, TODAY, "en"), "s2_photo");
  assert.equal(photo.kind, "PHOTO");
  assert.equal(photo.maxFiles, 1);
  const report = field(view.stepModel("s4", {}, TODAY, "en"), "s4_diagnosis_report");
  assert.equal(report.kind, "DIAGNOSIS");
  assert.equal(report.maxFiles, 3);
  const udid = field(view.stepModel("s2", { s2_udid_status: "HAVE" }, TODAY, "en"), "s2_udid_file");
  assert.equal(udid.kind, "UDID");
  assert.equal(udid.maxFiles, 1);
});

test("typed input becomes an answer of the right type", () => {
  const parse = (id, raw) => view.parseInput(id, raw);
  assert.equal(parse("s2_full_name", "  Arjun  "), "Arjun");
  assert.equal(parse("s2_full_name", "   "), null);
  assert.equal(parse("s3_primary_phone", "98765 43210"), "9876543210");
  assert.equal(parse("s3_pincode", "600 042"), "600042");
  assert.equal(parse("s3_siblings", "2"), 2);
  assert.equal(parse("s5_birth_weight", "2.9"), 2.9);
  assert.equal(parse("s3_siblings", ""), null);
  assert.equal(parse("s3_siblings", "two"), "two");
  assert.equal(parse("s2_gender", ""), null);
  assert.deepEqual(parse("s1_programs", ["YOGA", "SPORTS"]), ["YOGA", "SPORTS"]);
  assert.equal(parse("s11_consent", true), true);
});

test("the three date dropdowns become one date, or stay empty until all are chosen", () => {
  assert.equal(view.dateFromParts({ day: "14", month: "3", year: "2020" }), "2020-03-14");
  assert.equal(view.dateFromParts({ day: "", month: "3", year: "2020" }), null);
  assert.equal(view.dateFromParts({ day: "30", month: "2", year: "2020" }), "2020-02-30");
  assert.deepEqual(view.dateParts("2020-03-14"), { day: "14", month: "3", year: "2020" });
  assert.deepEqual(view.dateParts(null), { day: "", month: "", year: "" });
});

test("the age is shown from the date of birth", () => {
  assert.deepEqual(view.age("2020-03-14", TODAY), { years: 6, months: 6 });
  assert.equal(view.age("2020-02-30", TODAY), null);
  assert.equal(view.age(null, TODAY), null);
});

test("only answers that changed are sent when saving", () => {
  const before = { s1_centre: "VLC", s1_programs: ["YOGA"], s2_full_name: "Arjun" };
  const after = { s1_centre: "VLC", s1_programs: ["YOGA"], s2_full_name: "Arjun K", s2_gender: "MALE" };
  assert.deepEqual(view.changedValues(before, after), { s2_full_name: "Arjun K", s2_gender: "MALE" });
  assert.deepEqual(view.changedValues(before, { s1_centre: "VLC", s1_programs: ["YOGA"] }), { s2_full_name: null });
  assert.deepEqual(view.changedValues(before, before), {});
});
