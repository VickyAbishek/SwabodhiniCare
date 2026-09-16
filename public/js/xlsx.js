// scope: shared
/* A tiny Excel (.xlsx) writer for the browser (main spec §11.1): SpreadsheetML folded into a ZIP.
   The deflate stream uses stored blocks — a valid DEFLATE (method 8) that every reader opens, with no
   LZ77/Huffman of our own. UTF-8 throughout, so Tamil survives. Reused later by M9's backups. */
const UTF8 = new TextEncoder();

// The standard CRC-32 (IEEE 802.3), as the ZIP central directory needs it.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A DEFLATE stream of one or more "stored" (uncompressed) blocks, the last marked final.
function deflateStored(bytes) {
  const parts = [];
  let i = 0;
  while (i < bytes.length) {
    const chunk = Math.min(bytes.length - i, 0xffff);
    const final = i + chunk >= bytes.length;
    parts.push(final ? 0x01 : 0x00);                    // BFINAL | (BTYPE = 00)
    parts.push(chunk & 0xff, (chunk >> 8) & 0xff);      // LEN
    parts.push((~chunk) & 0xff, ((~chunk) >> 8) & 0xff); // NLEN (one's complement)
    for (let j = 0; j < chunk; j++) parts.push(bytes[i + j]);
    i += chunk;
  }
  return new Uint8Array(parts);
}

function u16(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); }
function u32(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach((p) => { out.set(p, off); off += p.length; });
  return out;
}

function zipFile(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = UTF8.encode(entry.name);
    const deflated = deflateStored(entry.data);
    const crc = crc32(entry.data);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    local.push(localHeader, deflated);
    central.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(entry.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + deflated.length;
  });
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(offset), u16(0),
  ]);
  return concat([...local, ...central, eocd]);
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colName(index) {
  let name = "";
  let n = index;
  while (n >= 0) { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; }
  return name;
}

function sheetXml(sheet) {
  const headerRow = sheet.headers.map((h, c) => `<c r="${colName(c)}1" t="inlineStr"><is><t>${xmlEscape(h)}</t></is></c>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((value, c) => `<c r="${colName(c)}${r + 2}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join("");
    return `<row r="${r + 2}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headerRow}</row>${rows}</sheetData></worksheet>`;
}

function workbookXml(sheetNames) {
  const sheets = sheetNames.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function relsXml(n) {
  const rels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypesXml(n) {
  const overrides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

export function buildXlsx(sheets) {
  const entries = [
    { name: "[Content_Types].xml", data: UTF8.encode(contentTypesXml(sheets.length)) },
    { name: "_rels/.rels", data: UTF8.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: UTF8.encode(workbookXml(sheets.map((s) => s.name))) },
    { name: "xl/_rels/workbook.xml.rels", data: UTF8.encode(relsXml(sheets.length)) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: UTF8.encode(sheetXml(s)) })),
  ];
  return new Blob([zipFile(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXlsx(filename, sheets) {
  const url = URL.createObjectURL(buildXlsx(sheets));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
