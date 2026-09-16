// scope: poc
/* Seeds a POC server with one application at every stage of the approval workflow, so the M6 queues
   have something in them before the form can collect a signature (M7). Every step goes through the
   real actions — create, submit, review, decide — so a change to a workflow rule stops the seed
   loudly instead of leaving behind rows the server could never have produced.

   The staff here are minted with a real PBKDF2 key, the same one the sign-in screen derives from the
   password the dev server prints (public/js/kdf.js). The test helpers in tests/poc/people.js build
   their people from a made-up key instead, so nobody can sign into those from a browser — which is
   exactly the bug this seed cannot afford, because its whole purpose is to be looked at.

   Not idempotent: it is meant for one run against the dev server's empty, in-memory store. Running
   it twice would leave two of everything, as creating two applications by hand would. */
import { createRequire } from "node:module";
import { createHash, pbkdf2Sync } from "node:crypto";
import { DEMO_CASES, DEMO_ITERATIONS, DEMO_PASSWORD, DEMO_PEOPLE, DEMO_SALT } from "./demo-data.mjs";

const require = createRequire(import.meta.url);
const { createContext, plain } = require("../../tests/poc/harness.js");
const SAMPLE_APPLICANT = require("../../tests/fixtures/sample-application.js");

const KEY_BYTES = 32;
const LOGIN_DOMAIN = "example.com";

// Derived once and shared: one 600,000-round run keeps the dev server's start-up quick. The server
// stores SHA-256 of the key and never sees the password, exactly as for a real account.
const DEMO_KEY = pbkdf2Sync(DEMO_PASSWORD, Buffer.from(DEMO_SALT, "hex"), DEMO_ITERATIONS, KEY_BYTES, "sha256").toString("hex");
const DEMO_HASH = createHash("sha256").update(DEMO_KEY, "utf8").digest("hex");

// A fixed clock keeps a seeded run repeatable; 09:30 in Chennai, so todayIso() is that day.
function clockFor(today) {
  if (!today) return undefined;
  const ms = Date.parse(`${today}T04:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`today must be an ISO date (YYYY-MM-DD), got ${today}`);
  return { ms };
}

// What the dev server prints and the tests read: no hashes, no keys, no tokens.
function staffCard(person) {
  return { name: person.name, fullName: person.fullName, email: `${person.name}@${LOGIN_DOMAIN}`, roles: person.roles.slice() };
}

function addPerson(ctx, person) {
  const card = staffCard(person);
  ctx.SC_Store.insert("Users", {
    id: `u-${card.name}`, email: card.email, name: card.fullName, roles: card.roles,
    password_hash: DEMO_HASH, password_salt: DEMO_SALT, kdf_iterations: DEMO_ITERATIONS,
    is_active: true, failed_logins: 0, must_change_password: false,
  });
  return card;
}

function signIn(ctx, person) {
  const result = plain(ctx.SC_Api.handle({
    action: "auth.login", data: { email: `${person.name}@${LOGIN_DOMAIN}`, key: DEMO_KEY },
  }));
  if (!result.ok) throw new Error(`The demo seed could not sign in as ${person.name}: ${result.error.code}`);
  return result.data.token;
}

// The answers for one case: the shared sample, renamed and moved to that case's centre, so the list
// and the reports are not five identical rows — minus whatever sections the case leaves blank (see
// `clear` in demo-data.mjs). Taken out here rather than saved away later: answers can only be added
// through applications.save, never emptied, and a case that must not have an answer must never be
// created with one.
function answersFor(ctx, demoCase) {
  const answers = Object.assign({}, SAMPLE_APPLICANT, {
    s1_centre: demoCase.centre,
    s10_suggested_centre: demoCase.centre,
    s2_full_name: demoCase.applicant,
    s2_name_ta: demoCase.nameTa,
    s3_father_name: demoCase.parents.father,
    s3_mother_name: demoCase.parents.mother,
    s11_parent_name: demoCase.parents.mother,
  });
  const dropped = {};
  (demoCase.clear || []).forEach((stepId) => {
    const step = ctx.SC_FormSchema.STEPS.find((s) => s.id === stepId);
    if (!step) throw new Error(`The demo case leaves ${stepId} blank, which is not a section of the form`);
    step.fields.forEach((field) => { dropped[field.id] = true; });
  });
  const kept = {};
  Object.keys(answers).forEach((id) => { if (!dropped[id]) kept[id] = answers[id]; });
  return kept;
}

// Whichever person holds the role this stage waits on. Taken from the workflow itself, so the seed
// cannot drift into reviewing as the wrong role.
function actorFor(ctx, people, status) {
  const role = ctx.SC_Workflow.reviewerRole(status);
  if (!role) throw new Error(`No reviewer is defined for ${status}`);
  const person = people.find((p) => p.roles.indexOf(role) !== -1);
  if (!person) throw new Error(`The demo people do not include a ${role}, so ${status} cannot be decided`);
  return person.name;
}

// One case: create, submit, then each step of its walk, ending at the stage the case is for.
function walkCase(ctx, people, call, demoCase) {
  const run = (who, action, data) => {
    const result = call(who, action, data);
    if (!result.ok) throw new Error(`${action} failed for ${who}: ${result.error.code}`);
    return result.data;
  };
  let application = run(demoCase.therapist, "applications.create", { values: answersFor(ctx, demoCase) });
  application = run(demoCase.therapist, "applications.submit", { id: application.id });
  for (const step of demoCase.steps) {
    const actor = actorFor(ctx, people, application.status);
    const data = { id: application.id, action: step.action, comment: step.comment };
    // Admitting is the Director's own decision and asks for their password again (spec §10.1).
    if (step.action === "ADMIT") data.key = DEMO_KEY;
    const action = step.action === "ADMIT" ? "applications.decide" : "applications.review";
    application = run(actor, action, data);
  }
  return application;
}

/* Seeds `ctx` (or a fresh one) and returns { ctx, call, people, applicationIds, statuses, ids,
   password, today }. `call(name, action, data)` runs one API call as one demo person and answers
   with the same { ok, data, error } envelope the app gets. */
export function seedDemoData(ctx, options = {}) {
  const context = ctx || createContext(clockFor(options.today));
  context.setup(); // tabs, centres and the HMAC secret: how a real deployment starts
  const people = DEMO_PEOPLE.map((person) => addPerson(context, person));
  const tokens = people.reduce((acc, person) => Object.assign(acc, { [person.name]: signIn(context, person) }), {});
  const call = (name, action, data) => {
    if (!tokens[name]) throw new Error(`Unknown demo person: ${name}`);
    return plain(context.SC_Api.handle({ action, data, token: tokens[name] }));
  };
  const cases = DEMO_CASES.map((demoCase) => walkCase(context, people, call, demoCase));
  const applicationIds = cases.map((application) => application.id);
  return {
    ctx: context,
    call,
    people,
    applicationIds,
    statuses: cases.map((application) => application.status),
    ids: applicationIds, // the name the brief's test sketch uses for the same list
    password: DEMO_PASSWORD,
    today: context.SC_Store.todayIso(),
  };
}
