const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeDriveApp, makeUtilities } = require("./fakes.js");

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47];

test("a fake Drive stores a file in a folder and hands it back by id", () => {
  const Drive = makeDriveApp();
  const Utilities = makeUtilities();
  const folder = Drive.getRootFolder().createFolder("attachments");
  const blob = Utilities.newBlob(PNG_HEAD, "image/png", "sig.png");

  const file = folder.createFile(blob);
  assert.equal(file.getName(), "sig.png");
  assert.equal(file.getSize(), 4);
  assert.deepEqual(Drive.getFileById(file.getId()).getBlob().getBytes(), PNG_HEAD);
});

test("a folder is found again rather than made twice", () => {
  const root = makeDriveApp().getRootFolder();
  const first = root.createFolder("attachments");
  const found = root.getFoldersByName("attachments");
  assert.equal(found.hasNext(), true);
  assert.equal(found.next().getId(), first.getId());
  assert.equal(root.getFoldersByName("nothing").hasNext(), false);
});

test("an unknown file id is an error, not a silent null", () => {
  assert.throws(() => makeDriveApp().getFileById("no-such-file"), /no-such-file/);
});

test("each fake Drive is its own, so files cannot leak between tests", () => {
  const a = makeDriveApp();
  const b = makeDriveApp();
  const file = a.getRootFolder().createFile(makeUtilities().newBlob(PNG_HEAD, "image/png", "sig.png"));
  assert.throws(() => b.getFileById(file.getId()));
});
