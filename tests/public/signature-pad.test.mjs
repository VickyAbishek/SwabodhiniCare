import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlank, boundsOf, trimToInk, fitTo } from "../../public/js/signature-pad.js";

const line = [[{ x: 10, y: 10 }, { x: 30, y: 20 }, { x: 50, y: 10 }]];

test("a stray tap is not a signature", () => {
  assert.equal(isBlank([]), true);
  assert.equal(isBlank([[]]), true);
  assert.equal(isBlank([[{ x: 5, y: 5 }]]), true, "one point is a tap, not a mark");
  assert.equal(isBlank([[{ x: 5, y: 5 }, { x: 5.4, y: 5.2 }]]), true, "a jitter is not a mark");
  assert.equal(isBlank(line), false);
});

test("bounds cover every stroke, and are null when there is no ink", () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf(line), { minX: 10, minY: 10, maxX: 50, maxY: 20 });
  assert.deepEqual(
    boundsOf([[{ x: 0, y: 8 }], [{ x: 4, y: 2 }]]),
    { minX: 0, minY: 2, maxX: 4, maxY: 8 },
  );
});

test("trimming moves the ink to the corner, keeping its shape", () => {
  const trimmed = trimToInk(line, 2);
  assert.deepEqual(boundsOf(trimmed), { minX: 2, minY: 2, maxX: 42, maxY: 12 });
  assert.equal(trimmed.length, line.length);
  assert.equal(trimmed[0].length, line[0].length);
});

test("trimming empty ink gives empty ink rather than throwing", () => {
  assert.deepEqual(trimToInk([], 2), []);
});

test("fitting scales to the box without distorting the hand", () => {
  // 40 wide x 10 tall into 400x100: both axes scale by 10, not by 10 and 20.
  const fitted = fitTo(trimToInk(line, 0), { width: 400, height: 100 });
  const b = boundsOf(fitted);
  assert.equal(b.maxX - b.minX, 400);
  assert.equal(b.maxY - b.minY, 100);

  // A tall mark is limited by height, and must not overflow the width.
  const tall = [[{ x: 0, y: 0 }, { x: 5, y: 100 }]];
  const f2 = boundsOf(fitTo(tall, { width: 400, height: 100 }));
  assert.equal(f2.maxY - f2.minY, 100);
  assert.ok(f2.maxX - f2.minX <= 400);
});

test("fitting ink with no size does not divide by zero", () => {
  const dot = [[{ x: 7, y: 7 }, { x: 7, y: 7 }]];
  assert.ok(Number.isFinite(boundsOf(fitTo(dot, { width: 400, height: 100 })).minX));

  // A perfectly straight horizontal line has no height at all: it must scale by the side it has.
  const flat = [[{ x: 0, y: 5 }, { x: 40, y: 5 }]];
  const f = boundsOf(fitTo(flat, { width: 400, height: 100 }));
  assert.equal(f.maxX - f.minX, 400);
  assert.equal(f.maxY - f.minY, 0);
});
