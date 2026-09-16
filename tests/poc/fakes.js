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
    newBlob: (bytes, mime, name) => {
      const blob = (b, t, n) => Object.freeze({
        getBytes: () => b.slice(),
        getContentType: () => t,
        getName: () => n,
        getAs: (type) => blob(b, type, n),
        setName: (newName) => blob(b, t, newName),
      });
      return blob(bytes, mime, name);
    },
    // Supports the patterns the server uses: yyyy MM dd HH mm ss.
    formatDate: (date, timeZone, format) => {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
        }).formatToParts(date).map((p) => [p.type, p.value])
      );
      return format.replace("yyyy", parts.year).replace("MM", parts.month).replace("dd", parts.day)
        .replace("HH", parts.hour).replace("mm", parts.minute).replace("ss", parts.second);
    },
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

// The slice of DriveApp that Attachments.gs and Backup.gs use. Files live in memory and are handed
// back by id, so a test can assert what was really written rather than that a method was called.
// An optional seed gives `getFileById` a file to find up front (the live Sheet is also a Drive file),
// while still throwing for ids that were never created — which fakes.test.js asserts.
function makeDriveApp(seedFiles = {}) {
  const files = new Map();
  const folders = new Map();
  const filesInFolder = new Map();
  let seq = 0;

  function addToFolder(folderId, file) {
    if (!filesInFolder.has(folderId)) filesInFolder.set(folderId, []);
    filesInFolder.get(folderId).push(file);
  }

  function makeFile(id, blob, folderId) {
    let trashed = false;
    const file = {
      getId: () => id,
      getName: () => blob.getName(),
      getSize: () => blob.getBytes().length,
      getBlob: () => blob,
      isTrashed: () => trashed,
      setTrashed: (value = true) => { trashed = value; return file; },
      makeCopy: (name, folder) => {
        const copyId = `file-${++seq}`;
        const copy = makeFile(copyId, blob.setName(name), folder.getId());
        files.set(copyId, copy);
        addToFolder(folder.getId(), copy);
        return copy;
      },
    };
    return file;
  }

  function makeFolder(id, name) {
    const folder = {
      getId: () => id,
      getName: () => name,
      createFolder(childName) {
        const child = makeFolder(`folder-${++seq}`, childName);
        folders.set(`${id}/${childName}`, child);
        return child;
      },
      getFoldersByName(childName) {
        const found = folders.get(`${id}/${childName}`);
        let taken = false;
        return {
          hasNext: () => Boolean(found) && !taken,
          next() {
            if (!found || taken) throw new Error(`no folder named ${childName}`);
            taken = true;
            return found;
          },
        };
      },
      createFile(blob) {
        const fileId = `file-${++seq}`;
        const file = makeFile(fileId, blob, id);
        files.set(fileId, file);
        addToFolder(id, file);
        return file;
      },
      getFiles() {
        const list = (filesInFolder.get(id) || []).slice();
        let i = 0;
        return {
          hasNext: () => i < list.length,
          next() {
            if (i >= list.length) throw new Error("no more files");
            return list[i++];
          },
        };
      },
    };
    return folder;
  }

  const root = makeFolder("root", "root");
  Object.entries(seedFiles).forEach(([id, seed]) => {
    const file = makeFile(id, seed.blob, seed.folderId || "root");
    files.set(id, file);
    addToFolder(seed.folderId || "root", file);
  });

  return Object.freeze({
    getRootFolder: () => root,
    getFileById(id) {
      const file = files.get(id);
      if (!file) throw new Error(`no file with id ${id}`);
      return file;
    },
  });
}

// Records sendEmail calls so a test can assert who got the backup result and what it said.
function makeMailApp() {
  const sent = [];
  return {
    sent,
    sendEmail(to, subject, body) {
      sent.push({ to, subject, body });
    },
  };
}

// Records the time-based triggers setup() installs, so they can be asserted (or safely re-created).
function makeScriptApp() {
  const triggers = [];
  return {
    triggers,
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger(trigger) {
      const i = triggers.indexOf(trigger);
      if (i !== -1) triggers.splice(i, 1);
    },
    newTrigger(functionName) {
      return {
        timeBased() {
          let monthDay = null;
          const builder = {
            onMonthDay(day) { monthDay = day; return builder; },
            create() {
              const trigger = {
                getHandlerFunction: () => functionName,
                monthDay,
              };
              triggers.push(trigger);
              return trigger;
            },
          };
          return builder;
        },
      };
    },
  };
}

module.exports = {
  makeUtilities,
  makeDriveApp,
  makeSpreadsheetApp,
  makeLockService,
  makeCacheService,
  makePropertiesService,
  makeContentService,
  makeConsole,
  makeDate,
  makeMailApp,
  makeScriptApp,
};
