// Test-only, in-memory fakes of the Apps Script services used by poc/apps-script.
// They mimic the behaviour the server relies on (signed digest bytes, lock timeouts, cache expiry).
const crypto = require("node:crypto");

function toSigned(buffer) {
  return Array.from(buffer, (b) => (b > 127 ? b - 256 : b));
}

function toBuffer(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(value.map((b) => (b + 256) % 256));
}

function makeUtilities() {
  return {
    DigestAlgorithm: { SHA_256: "sha256", MD5: "md5" },
    Charset: { UTF_8: "utf8" },
    computeDigest: (algorithm, value) => toSigned(crypto.createHash(algorithm).update(toBuffer(value)).digest()),
    computeHmacSha256Signature: (value, key) =>
      toSigned(crypto.createHmac("sha256", toBuffer(key)).update(toBuffer(value)).digest()),
    getUuid: () => crypto.randomUUID(),
    base64Encode: (data) => toBuffer(data).toString("base64"),
    base64Decode: (text) => toSigned(Buffer.from(text, "base64")),
    sleep: () => {},
  };
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r += 1) {
      const line = this.sheet.rows[this.row - 1 + r] || [];
      const values = [];
      for (let c = 0; c < this.cols; c += 1) {
        const v = line[this.col - 1 + c];
        values.push(v === undefined ? "" : v);
      }
      out.push(values);
    }
    return out;
  }

  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }

  setValue(value) {
    this.sheet.set(this.row, this.col, value);
    return this;
  }

  setNumberFormat(format) {
    for (let c = 0; c < this.cols; c += 1) this.sheet.formats[this.col + c] = format;
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.formats = {};
  }

  getName() {
    return this.name;
  }

  getMaxRows() {
    return Math.max(1000, this.rows.length);
  }

  set(row, col, value) {
    while (this.rows.length < row) this.rows.push([]);
    const line = this.rows[row - 1];
    while (line.length < col) line.push("");
    line[col - 1] = value;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((max, line) => Math.max(max, line.length), 0);
  }

  appendRow(values) {
    this.rows.push(values.slice());
    return this;
  }

  getRange(row, col, rows = 1, cols = 1) {
    return new FakeRange(this, row, col, rows, cols);
  }

  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  setFrozenRows() {
    return this;
  }
}

class FakeSpreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = new Map();
  }

  getId() {
    return this.id;
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  getSheets() {
    return [...this.sheets.values()];
  }
}

function makeSpreadsheetApp() {
  const books = new Map();
  return {
    openById(id) {
      if (!books.has(id)) books.set(id, new FakeSpreadsheet(id));
      return books.get(id);
    },
    create(name) {
      const book = new FakeSpreadsheet(`sheet-${books.size + 1}`);
      book.name = name;
      books.set(book.id, book);
      return book;
    },
  };
}

function makeLockService() {
  const state = { held: false };
  const newLock = () => {
    let mine = false;
    const lock = {
      tryLock() {
        if (state.held) return false;
        state.held = true;
        mine = true;
        return true;
      },
      waitLock(ms) {
        if (!lock.tryLock(ms)) throw new Error("Lock timeout: another process was holding the lock for too long.");
      },
      releaseLock() {
        if (mine) state.held = false;
        mine = false;
      },
      hasLock: () => mine,
    };
    return lock;
  };
  return { getScriptLock: newLock, state };
}

function makeCacheService(clock) {
  const store = new Map();
  const cache = {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expires <= clock.ms) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    put(key, value, seconds = 600) {
      store.set(key, { value: String(value), expires: clock.ms + Math.min(seconds, 21600) * 1000 });
    },
    remove(key) {
      store.delete(key);
    },
  };
  return { getScriptCache: () => cache };
}

function makePropertiesService(initial) {
  const props = Object.assign({}, initial);
  const api = {
    getProperty: (key) => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
    setProperty(key, value) {
      props[key] = String(value);
      return api;
    },
    deleteProperty(key) {
      delete props[key];
      return api;
    },
    getProperties: () => Object.assign({}, props),
  };
  return { getScriptProperties: () => api };
}

function makeContentService() {
  return {
    MimeType: { JSON: "application/json", TEXT: "text/plain" },
    createTextOutput(text) {
      let mime = "text/plain";
      const out = {
        getContent: () => text,
        getMimeType: () => mime,
        setMimeType(value) {
          mime = value;
          return out;
        },
      };
      return out;
    },
  };
}

function makeConsole(logs) {
  return {
    log: (...args) => logs.info.push(args),
    info: (...args) => logs.info.push(args),
    warn: (...args) => logs.warns.push(args),
    error: (...args) => logs.errors.push(args),
  };
}

// `new Date()` and `Date.now()` follow the test clock; `new Date(value)` behaves normally.
function makeDate(clock) {
  return class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [clock.ms]));
    }

    static now() {
      return clock.ms;
    }
  };
}

module.exports = {
  makeUtilities,
  makeSpreadsheetApp,
  makeLockService,
  makeCacheService,
  makePropertiesService,
  makeContentService,
  makeConsole,
  makeDate,
};
