const { test } = require("node:test");
const assert = require("node:assert/strict");
const N = require("../../shared/numbers.js");

test("formatAppNo pads the sequence to four digits", () => {
  assert.equal(N.formatAppNo(2026, 42), "APP-2026-0042");
  assert.equal(N.formatAppNo(2026, 9999), "APP-2026-9999");
});

test("formatRegNo builds SWB/<centre>/<year>/<seq>", () => {
  assert.equal(N.formatRegNo("VLC", 2026, 13), "SWB/VLC/2026/0013");
});

test("the four centre codes are known", () => {
  assert.deepEqual([...N.CENTRE_CODES], ["TVM", "VLC", "TDP", "SLR"]);
  assert.ok(Object.isFrozen(N.CENTRE_CODES));
});

test("unknown centres, bad sequences and bad years are rejected", () => {
  assert.throws(() => N.formatRegNo("XYZ", 2026, 1), RangeError);
  assert.throws(() => N.formatAppNo(2026, 0), RangeError);
  assert.throws(() => N.formatAppNo(2026, 10000), RangeError);
  assert.throws(() => N.formatAppNo(2026, 1.5), RangeError);
  assert.throws(() => N.formatAppNo(26, 1), RangeError);
});
