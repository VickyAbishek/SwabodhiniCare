// scope: shared
// Saves form answers in the background (main spec §12): 20 seconds after a change, and straight
// away when moving between steps. One save at a time; only changed answers are sent, with the
// version they were based on. If someone else saved first, saving stops until the form is reloaded.
export const AUTOSAVE_MS = 20000;

export function createAutosave({
  save, diff, intervalMs = AUTOSAVE_MS, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => new Date(), onStatus = () => {},
}) {
  let saved = {}; // answers as the server last confirmed them
  let latest = {}; // answers on the screen now
  let version = 0;
  let timer = null;
  let inFlight = null;
  let stopped = false; // after a clash with someone else's save

  const pendingChanges = () => diff(saved, latest);
  const hasChanges = () => Object.keys(pendingChanges()).length > 0;

  function cancel() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    if (timer || stopped) return;
    timer = setTimer(() => {
      timer = null;
      return flush();
    }, intervalMs);
  }

  async function saveNow() {
    const patch = pendingChanges();
    const sent = Object.assign({}, latest);
    onStatus({ state: "saving" });
    const result = await save(patch, version);
    if (result.ok) {
      saved = sent;
      version = result.data.version;
      onStatus({ state: "saved", at: now() });
    } else if (result.error.code === "VERSION_CONFLICT") {
      stopped = true;
      cancel();
      onStatus({ state: "conflict", code: "VERSION_CONFLICT" });
    } else {
      onStatus({ state: "error", code: result.error.code });
      schedule(); // try again later
    }
    return result;
  }

  async function flush() {
    while (inFlight) await inFlight;
    if (stopped) return { ok: false, data: null, error: { code: "VERSION_CONFLICT" } };
    cancel();
    if (!hasChanges()) return { ok: true, data: { version }, error: null };
    inFlight = saveNow();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return Object.freeze({
    start(initial) {
      saved = Object.assign({}, initial.values);
      latest = Object.assign({}, initial.values);
      version = initial.version;
      stopped = false;
    },
    update(values) {
      latest = Object.assign({}, values);
      if (stopped || !hasChanges()) return;
      onStatus({ state: "pending" });
      schedule();
    },
    flush,
    stop: cancel,
    version: () => version,
    hasUnsaved: () => Boolean(inFlight) || hasChanges(),
  });
}
