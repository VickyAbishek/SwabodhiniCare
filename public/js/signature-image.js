// scope: shared
// Turns drawn strokes into a PNG for upload. Geometry (trim/fit) is in signature-pad.js; the canvas
// drawing is here because it needs the DOM. The consent pad and the Director's signature in Settings
// both use it, so every stored signature prints alike.
import { trimToInk, fitTo } from "./signature-pad.js";

const BOX = { width: 560, height: 180 };

export function strokesToPng(strokes) {
  const fitted = fitTo(trimToInk(strokes, 0), BOX);
  const out = document.createElement("canvas");
  out.width = BOX.width + 16;
  out.height = BOX.height + 16;
  const pen = out.getContext("2d");
  pen.lineWidth = 2.5;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  pen.strokeStyle = "#111";
  for (const stroke of fitted) {
    if (stroke.length < 2) continue;
    pen.beginPath();
    pen.moveTo(stroke[0].x + 8, stroke[0].y + 8);
    for (const point of stroke.slice(1)) pen.lineTo(point.x + 8, point.y + 8);
    pen.stroke();
  }
  return out.toDataURL("image/png").split(",")[1];
}
