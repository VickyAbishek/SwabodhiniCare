import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createRegPreview } from "../../public/js/reg-preview.js";

const require = createRequire(import.meta.url);
const numbers = require("../../shared/numbers.js");
const TODAY = "2026-09-15";
const preview = createRegPreview({ numbers, today: () => TODAY });

test("the preview shows the centre and the year, and leaves the sequence to the server", () => {
  const line = preview.show({ centre: "VLC", registrationNo: null });
  assert.equal(line.labelKey, "decide.regNo");
  assert.equal(line.hintKey, "decide.regNoPreview");
  assert.equal(line.value, "SWB/VLC/2026/…");
  // Nothing that could be read as a number the server issued: no sequence where one goes.
  assert.equal(/\d{4}$/.test(line.value), false);
});

test("the year is the school's, the same one the issued number takes", () => {
  const newYear = createRegPreview({ numbers, today: () => "2027-01-01" });
  assert.equal(newYear.show({ centre: "TVM", registrationNo: null }).value, "SWB/TVM/2027/…");
});

test("a number already issued is shown as itself, not as a preview", () => {
  // A reopened file that has come back to the Director's desk keeps its number (decision #5).
  assert.deepEqual(preview.show({ centre: "VLC", registrationNo: "SWB/VLC/2026/0004" }), {
    labelKey: "decide.registrationNumber", value: "SWB/VLC/2026/0004", hintKey: "",
  });
});

test("a file whose centre has no code gets no number line at all", () => {
  assert.equal(preview.show({ centre: "MAD", registrationNo: null }), null);
  assert.equal(preview.show({ centre: null, registrationNo: null }), null);
});

test("the preview is a prefix of the number the server would mint, in its own format", () => {
  const issued = numbers.formatRegNo("VLC", 2026, 13);
  assert.equal(issued, "SWB/VLC/2026/0013");
  assert.ok(issued.startsWith(preview.show({ centre: "VLC", registrationNo: null }).value.slice(0, -1)));
});
