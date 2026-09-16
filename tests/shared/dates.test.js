const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../shared/dates.js");

test("ageFrom counts whole years and months", () => {
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-09-15"), { years: 6, months: 6 });
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-09-13"), { years: 6, months: 5 });
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-03-14"), { years: 6, months: 0 });
  assert.deepEqual(D.ageFrom("2026-09-15", "2026-09-15"), { years: 0, months: 0 });
});

test("ageFrom rejects a birth date in the future", () => {
  assert.throws(() => D.ageFrom("2026-09-16", "2026-09-15"), RangeError);
});

test("isValidDateParts knows month lengths and leap years", () => {
  assert.equal(D.isValidDateParts(2024, 2, 29), true);
  assert.equal(D.isValidDateParts(2023, 2, 29), false);
  assert.equal(D.isValidDateParts(2026, 4, 31), false);
  assert.equal(D.isValidDateParts(2026, 13, 1), false);
  assert.equal(D.isValidDateParts(2026, 1, 0), false);
});

test("parseIsoDate accepts only real YYYY-MM-DD dates", () => {
  assert.deepEqual(D.parseIsoDate("2020-03-14"), { year: 2020, month: 3, day: 14 });
  assert.throws(() => D.parseIsoDate("2026-9-1"), RangeError);
  assert.throws(() => D.parseIsoDate("2026-02-30"), RangeError);
});

test("toIsoDate pads month and day", () => {
  assert.equal(D.toIsoDate(2020, 3, 4), "2020-03-04");
  assert.throws(() => D.toIsoDate(2023, 2, 29), RangeError);
});

test("daysBetween counts calendar days", () => {
  assert.equal(D.daysBetween("2026-09-06", "2026-09-15"), 9);
  assert.equal(D.daysBetween("2026-08-31", "2026-09-01"), 1);
  assert.equal(D.daysBetween("2026-09-15", "2026-09-15"), 0);
});
