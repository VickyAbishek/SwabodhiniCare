import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, crc32 } from "../../public/js/xlsx.js";

function zipEntries(bytes) {
  const entries = [];
  let off = 0;
  while (off + 30 <= bytes.length && bytes[off] === 0x50 && bytes[off + 1] === 0x4b && bytes[off + 2] === 0x03 && bytes[off + 3] === 0x04) {
    const nameLen = bytes[off + 26] | (bytes[off + 27] << 8);
    const extraLen = bytes[off + 28] | (bytes[off + 29] << 8);
    const compSize = bytes[off + 18] | (bytes[off + 19] << 8) | (bytes[off + 20] << 16) | (bytes[off + 21] << 24);
    const name = new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + nameLen));
    const data = bytes.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + compSize);
    entries.push({ name, data });
    off += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("buildXlsx produces a ZIP whose sheet deflate inflates to the UTF-8 XML", async () => {
  const blob = buildXlsx([{ name: "Register", headers: ["App No", "Name"], rows: [["APP-2026-0001", "அர்ஜுன்"]] }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const entries = zipEntries(bytes);
  assert.deepEqual(entries.map((e) => e.name), [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml",
  ]);
  const xml = new TextDecoder().decode(inflateRawSync(entries.find((e) => e.name === "xl/worksheets/sheet1.xml").data));
  assert.ok(xml.includes("அர்ஜுன்")); // Tamil bytes survive the round-trip
  assert.ok(xml.includes("APP-2026-0001"));
});

test("special XML characters are escaped in cells", async () => {
  const blob = buildXlsx([{ name: "S", headers: ["A"], rows: [["a < b & 'c' \"d\""]] }]);
  const entries = zipEntries(new Uint8Array(await blob.arrayBuffer()));
  const xml = new TextDecoder().decode(inflateRawSync(entries.find((e) => e.name.endsWith("sheet1.xml")).data));
  assert.ok(xml.includes("a &lt; b &amp; &apos;c&apos; &quot;d&quot;"));
});
