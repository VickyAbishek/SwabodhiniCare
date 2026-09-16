// scope: shared
// Shrinks a photo before upload (main spec §10.3): a JPEG at most maxDim on its longest side and
// under target bytes. PDFs and other non-images pass through untouched — the 5 MB server cap is the
// only ceiling they meet. The geometry is pure so tests reach it without a DOM; only compress() and
// blobToBase64() touch the browser.
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5];
const FLOOR = 0.5;

// Keeps the aspect and never upscales: the result fits inside maxDim on both sides.
export function fitInside(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// The first quality (highest) whose output is under the target, or the floor when none is.
// `sizes[i]` is the JPEG size in bytes QUALITY_STEPS[i] produced.
export function qualityFor(sizes, target) {
  for (let i = 0; i < QUALITY_STEPS.length; i++) {
    if (sizes[i] <= target) return QUALITY_STEPS[i];
  }
  return FLOOR;
}

export async function compress(file, { maxDim = 1600, target = 300 * 1024 } = {}) {
  const bitmap = await loadImage(file);
  const { width, height } = fitInside(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d");
  pen.drawImage(bitmap, 0, 0, width, height);
  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= target) return blob;
  }
  return toBlob(canvas, FLOOR);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned nothing"))), "image/jpeg", quality);
  });
}
