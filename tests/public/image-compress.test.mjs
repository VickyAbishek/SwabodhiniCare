import { test } from "node:test";
import assert from "node:assert/strict";
import { fitInside, qualityFor } from "../../public/js/image-compress.js";

test("fitInside keeps the aspect, never upscales, and fits the box", () => {
  assert.deepEqual(fitInside(3200, 2400, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitInside(2400, 3200, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitInside(800, 600, 1600), { width: 800, height: 600 }, "small images are not upscaled");
  assert.deepEqual(fitInside(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitInside(0, 0, 1600), { width: 0, height: 0 });
});

test("qualityFor steps down to the first size under the target, else the floor", () => {
  // QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5]
  assert.equal(qualityFor([400 * 1024, 350 * 1024, 280 * 1024], 300 * 1024), 0.7);
  assert.equal(qualityFor([200 * 1024], 300 * 1024), 0.9, "the highest quality wins when it already fits");
  assert.equal(qualityFor([500 * 1024, 450 * 1024, 400 * 1024, 350 * 1024, 320 * 1024], 300 * 1024), 0.5, "falls back to the floor");
});
