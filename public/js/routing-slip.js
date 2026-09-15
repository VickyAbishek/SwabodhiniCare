// scope: shared
// The four-step approval route (main spec §5): the therapist fills the form in, then one reviewer per
// stage decides, and the routing slip shows all four steps. The model is pure — the workflow, the
// translator and the date formatter are passed in, as form-view.js takes the schema — so the steps
// and the slip can be tested without a DOM. Only trackElement touches the page.
const STAGES = ["THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"];

// Where a file rests when no reviewer is holding it. A draft, or one sent back, is being worked on;
// rejected or withdrawn, it is out of the route — either way it is back on the therapist's desk. An
// admitted file has run the whole route.
const RESTING_STEP = { DRAFT: 1, RETURNED: 1, REJECTED: 1, WITHDRAWN: 1, ADMITTED: 4 };

// The actions that move a file on. A send-back or a rejection does not: it leaves the file where the
// reviewer put it, so their step is ahead of it again rather than approved.
const MOVES_ON = ["APPROVE", "ADMIT", "WAITLIST"];

export function createRoutingSlip({ workflow, t, formatDate }) {
  if (!workflow || !t || !formatDate) {
    throw new Error("The routing slip needs the workflow, a translator and a date formatter");
  }

  function stepFor(status) {
    // Which reviewer decides at a waiting status comes from the workflow itself, so this cannot
    // drift from the rule the server enforces.
    const reviewer = workflow.reviewerRole(status);
    const index = reviewer ? STAGES.indexOf(reviewer) : -1;
    if (index > 0) return index + 1;
    const resting = RESTING_STEP[status];
    if (!resting) throw new Error(`The routing track has no step for ${status}`);
    return resting;
  }

  // { step, total, label }: the step the file is on and the role holding it. label is a role key —
  // the screen shows it with role.<label> — so the model needs no wording of its own here.
  function track(status) {
    const step = stepFor(status);
    return { step, total: STAGES.length, label: STAGES[step - 1] };
  }

  // The last word from each stage: the server hands the approvals over oldest first.
  function latestByStage(approvals) {
    return (approvals || []).reduce((latest, row) => Object.assign(latest, { [row.stage]: row }), {});
  }

  function metaFor(stage, state, approval, arrivedAt, submittedAt, filledInAt) {
    if (stage === "THERAPIST") {
      if (submittedAt) return t("slip.sent", { date: formatDate(submittedAt) });
      if (filledInAt) return t("slip.filledIn", { date: formatDate(filledInAt) });
      return t("slip.notYet");
    }
    if (approval && MOVES_ON.indexOf(approval.action) !== -1) {
      return t("slip.approved", { date: formatDate(approval.at) });
    }
    if (state === "now") return t("slip.waitingSince", { date: formatDate(arrivedAt) });
    return t("slip.notYet");
  }

  /* The slip, one row per step: [{ stage, state: "done" | "now" | "todo", name, meta, comment }].
     `names` carries the display name for a step nobody has signed yet — the therapist who filed the
     form, and "You" (slip.you) when the step is the reader's own. `comment` keeps what each stage
     said, so an earlier round's note stays on the slip after a send-back. */
  function slip({ status, approvals, names, submittedAt, filledInAt }) {
    const step = stepFor(status);
    const acted = latestByStage(approvals);
    const given = names || {};

    return STAGES.reduce(
      (carried, stage, i) => {
        const index = i + 1;
        const state = index < step ? "done" : index === step ? "now" : "todo";
        const approval = acted[stage] || null;
        const row = {
          stage,
          state,
          name: (approval && approval.userName) || given[stage] || "",
          meta: metaFor(stage, state, approval, carried.arrivedAt, submittedAt, filledInAt),
          comment: approval ? approval.comment || null : null,
        };
        // The file moved on the day that stage acted, so the next step waits from then.
        return { arrivedAt: approval ? approval.at : carried.arrivedAt, rows: carried.rows.concat([row]) };
      },
      { arrivedAt: submittedAt, rows: [] }
    ).rows;
  }

  return Object.freeze({ track, slip });
}

// The four-step track as the queue cards and the review screen show it: a bar of one segment per
// step, then where the file is in words. The caller passes its translator, as it does to the model.
export function trackElement(model, t) {
  const wrap = document.createElement("div");
  wrap.className = "track";
  const bar = document.createElement("div");
  bar.className = "track-bar";
  bar.setAttribute("aria-hidden", "true");
  for (let i = 1; i <= model.total; i += 1) {
    const segment = document.createElement("span");
    if (i < model.step) segment.className = "done";
    else if (i === model.step) segment.className = "now";
    bar.append(segment);
  }
  const text = document.createElement("div");
  text.className = "track-text";
  text.textContent = t("queue.stepOf", { n: model.step, role: t(`role.${model.label}`) });
  wrap.append(bar, text);
  return wrap;
}
