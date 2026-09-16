import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutosave, saveStatusKey } from "../../public/js/autosave.js";

function diff(before, after) {
  const out = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) out[key] = after[key] ?? null;
  }
  return out;
}

function fakeTimers() {
  let queue = [];
  return {
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      queue.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      queue = queue.filter((t) => t !== timer);
    },
    async runAll() {
      const due = queue;
      queue = [];
      for (const timer of due) await timer.fn();
    },
    get delays() {
      return queue.map((t) => t.ms);
    },
  };
}

const ok = (version) => ({ ok: true, data: { version }, error: null });
const fail = (code) => ({ ok: false, data: null, error: { code } });
const NOW = new Date("2026-09-15T05:12:00Z");

function setup(replies) {
  const timers = fakeTimers();
  const calls = [];
  const statuses = [];
  let reply = 0;
  const autosave = createAutosave({
    diff,
    save: async (patch, version) => {
      calls.push({ patch, version });
      return typeof replies[reply] === "function" ? replies[reply++]() : replies[reply++];
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => NOW,
    onStatus: (status) => statuses.push(status),
  });
  autosave.start({ values: { s1_centre: "VLC" }, version: 1 });
  return { autosave, timers, calls, statuses };
}

test("nothing is saved when nothing changed", async () => {
  const { autosave, timers, calls } = setup([]);
  autosave.update({ s1_centre: "VLC" });
  await autosave.flush();
  assert.deepEqual(timers.delays, []);
  assert.equal(calls.length, 0);
  assert.equal(autosave.hasUnsaved(), false);
});

test("a change is saved 20 seconds later, sending only what changed", async () => {
  const { autosave, timers, calls, statuses } = setup([ok(2)]);
  autosave.update({ s1_centre: "VLC", s2_full_name: "Arjun" });
  assert.deepEqual(timers.delays, [20000]);
  assert.equal(statuses.at(-1).state, "pending");
  assert.equal(autosave.hasUnsaved(), true);
  await timers.runAll();
  assert.deepEqual(calls, [{ patch: { s2_full_name: "Arjun" }, version: 1 }]);
  assert.deepEqual(statuses.at(-1), { state: "saved", at: NOW });
  assert.equal(autosave.version(), 2);
  assert.equal(autosave.hasUnsaved(), false);
});

test("several changes before the timer become one save of the latest answers", async () => {
  const { autosave, timers, calls } = setup([ok(2)]);
  autosave.update({ s1_centre: "VLC", s2_full_name: "Arj" });
  autosave.update({ s1_centre: "VLC", s2_full_name: "Arjun" });
  assert.deepEqual(timers.delays, [20000]);
  await timers.runAll();
  assert.deepEqual(calls.map((c) => c.patch), [{ s2_full_name: "Arjun" }]);
});

test("moving to another step saves straight away", async () => {
  const { autosave, timers, calls } = setup([ok(2)]);
  autosave.update({ s1_centre: "TVM" });
  const result = await autosave.flush();
  assert.equal(result.ok, true);
  assert.deepEqual(timers.delays, []);
  assert.deepEqual(calls, [{ patch: { s1_centre: "TVM" }, version: 1 }]);
});

test("one save at a time; changes made during a save follow straight after", async () => {
  let release;
  const slow = () => new Promise((resolve) => { release = () => resolve(ok(2)); });
  const { autosave, calls } = setup([slow, ok(3)]);
  autosave.update({ s1_centre: "TVM" });
  const first = autosave.flush();
  autosave.update({ s1_centre: "TVM", s2_full_name: "Arjun" });
  const second = autosave.flush();
  assert.equal(calls.length, 1);
  release();
  await first;
  await second;
  assert.deepEqual(calls, [
    { patch: { s1_centre: "TVM" }, version: 1 },
    { patch: { s2_full_name: "Arjun" }, version: 2 },
  ]);
  assert.equal(autosave.version(), 3);
});

test("a Wi-Fi failure shows 'not saved' and tries again on the next timer", async () => {
  const { autosave, timers, calls, statuses } = setup([fail("NETWORK_ERROR"), ok(2)]);
  autosave.update({ s1_centre: "TVM" });
  await autosave.flush();
  assert.deepEqual(statuses.at(-1), { state: "error", code: "NETWORK_ERROR" });
  assert.equal(autosave.hasUnsaved(), true);
  assert.deepEqual(timers.delays, [20000]);
  await timers.runAll();
  assert.equal(calls.length, 2);
  assert.equal(statuses.at(-1).state, "saved");
});

test("if someone else saved first, saving stops and asks for a reload", async () => {
  const { autosave, timers, calls, statuses } = setup([fail("VERSION_CONFLICT")]);
  autosave.update({ s1_centre: "TVM" });
  await autosave.flush();
  assert.deepEqual(statuses.at(-1), { state: "conflict", code: "VERSION_CONFLICT" });
  autosave.update({ s1_centre: "SLR" });
  await autosave.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(timers.delays, []);
});

test("stop cancels a waiting save", () => {
  const { autosave, timers } = setup([]);
  autosave.update({ s1_centre: "TVM" });
  autosave.stop();
  assert.deepEqual(timers.delays, []);
});

test("each save state names its own wording, so a clash is never blamed on the network", () => {
  assert.equal(saveStatusKey("pending"), "form.pending");
  assert.equal(saveStatusKey("saving"), "form.saving");
  assert.equal(saveStatusKey("saved"), "form.saved");
  assert.equal(saveStatusKey("error"), "form.notSaved");
  // The one this test exists for: someone else's save is not a Wi-Fi problem,
  // and checking Wi-Fi will never clear it.
  assert.equal(saveStatusKey("conflict"), "form.notSavedConflict");
  assert.notEqual(saveStatusKey("conflict"), saveStatusKey("error"));
});

test("a state with no wording of its own says nothing rather than guessing", () => {
  assert.equal(saveStatusKey("something-new"), "");
  assert.equal(saveStatusKey(undefined), "");
});
