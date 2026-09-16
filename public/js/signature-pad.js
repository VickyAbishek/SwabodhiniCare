// scope: shared
/* The parent's signature, drawn on screen (main spec §6 step 11).

   Geometry only: the canvas and the pointer events live in the page module that uses this, so
   what decides whether a mark counts can be tested without a browser. tests/public/ covers only
   pure modules, and every pages/*.js is untested — which is how a one-line mapping bug sat wrong
   in pages/application.js until it was found by hand. */

// Below this a mark is a tap or a jitter rather than a signature. CSS pixels.
const MIN_INK = 4;

export function boundsOf(strokes) {
  let box = null;
  for (const stroke of strokes) {
    for (const point of stroke) {
      if (!box) box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      else {
        box.minX = Math.min(box.minX, point.x);
        box.minY = Math.min(box.minY, point.y);
        box.maxX = Math.max(box.maxX, point.x);
        box.maxY = Math.max(box.maxY, point.y);
      }
    }
  }
  return box;
}

export function isBlank(strokes) {
  const box = boundsOf(strokes);
  if (!box) return true;
  const points = strokes.reduce((n, stroke) => n + stroke.length, 0);
  if (points < 2) return true;
  return (box.maxX - box.minX) < MIN_INK && (box.maxY - box.minY) < MIN_INK;
}

function mapPoints(strokes, fn) {
  return strokes.map((stroke) => stroke.map(fn));
}

export function trimToInk(strokes, padding) {
  const box = boundsOf(strokes);
  if (!box) return [];
  const pad = padding || 0;
  return mapPoints(strokes, (p) => ({ x: p.x - box.minX + pad, y: p.y - box.minY + pad }));
}

export function fitTo(strokes, box) {
  const ink = boundsOf(strokes);
  if (!ink) return [];
  const width = ink.maxX - ink.minX;
  const height = ink.maxY - ink.minY;
  // One scale for both axes, or the hand that wrote it comes out stretched. A mark with no
  // width or no height — a straight line — scales by whichever side it does have.
  const scaleX = width > 0 ? box.width / width : Infinity;
  const scaleY = height > 0 ? box.height / height : Infinity;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return strokes.map((stroke) => stroke.slice());
  return mapPoints(strokes, (p) => ({
    x: (p.x - ink.minX) * scale,
    y: (p.y - ink.minY) * scale,
  }));
}
