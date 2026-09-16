// scope: poc
/* What the dev server seeds: the fictional staff a person can sign in as, and one application per
   case, each ending at a different stage of the approval workflow. Data only — the walking lives in
   demo-applications.mjs — so adding a case later is an edit to the tables below. */

// The demo password, printed by the dev server next to the first-admin code. Fictional, and shared
// by every demo person, so the seed derives the sign-in key once. The salt and the round count are
// fixed so a restarted server produces the same accounts.
export const DEMO_PASSWORD = "demo-pass-2026";
export const DEMO_SALT = "0123456789abcdef0123456789abcdef";
export const DEMO_ITERATIONS = 600000;

// Two therapists (so each has work of their own) and the three people whose queues the workflow
// sends applications to. `name` is the sign-in handle; the email is name@example.com.
export const DEMO_PEOPLE = Object.freeze([
  { name: "priya", fullName: "Priya Raman", roles: ["THERAPIST"] },
  { name: "deepa", fullName: "Deepa Krishnan", roles: ["THERAPIST"] },
  { name: "lakshmi", fullName: "Lakshmi Narayanan", roles: ["THERAPY_HEAD"] },
  { name: "suresh", fullName: "Suresh Kumar", roles: ["CENTRE_HEAD"] },
  { name: "revathi", fullName: "Revathi Menon", roles: ["DIRECTOR"] },
]);

// One application per case. `steps` are walked in order through the real actions, and each action is
// taken by whichever person's role the application is waiting on at that moment — except SAVE, which
// is the owner's own edit and waits on no stage. The comment on each case is the stage it must end at;
// tests/poc/seed.test.mjs holds the seed to it.
//
// `clear` names whole sections left unanswered on that case, which is a file the server really
// accepts: submit checks the required answers only, and such a section has none. A required answer
// cannot be left out that way — it has to be there to submit — so a case that needs one missing
// clears it afterwards with the SAVE step, which is the other move the product has: applications.save
// patches the whole row, so an answer left out of the patch is written as an empty cell, and a draft
// is not held to the required answers. Both kinds of gap are for the therapist's screen, whose "Steps
// to fix" list is empty on a file with every answer in place — and whose resend, for the same reason,
// is never refused.
export const DEMO_CASES = Object.freeze([
  // Waiting: Therapy Head
  { applicant: "Nila M", nameTa: "நிலா", centre: "TVM", therapist: "priya",
    parents: { father: "Mohan R", mother: "Vidhya M" }, steps: [] },
  // Waiting: Centre Head
  { applicant: "Arjun K", nameTa: "அர்ஜுன்", centre: "VLC", therapist: "deepa",
    parents: { father: "Karthik S", mother: "Anitha K" }, steps: [{ action: "APPROVE" }] },
  // Waiting: Director
  { applicant: "Vishal S", nameTa: "விஷால்", centre: "TDP", therapist: "priya",
    parents: { father: "Sekar V", mother: "Kalaiselvi S" }, steps: [{ action: "APPROVE" }, { action: "APPROVE" }] },
  // Sent back to the family, with the reason on the routing slip and the work still to do: the
  // development history nobody has started, and the diagnosis answer the therapist took out to answer
  // again after the reviewer asked for it — the required gap that stops the file going back until it
  // is filled in. Both are what the therapist's "Steps to fix" list is for.
  { applicant: "Meena R", nameTa: "மீனா", centre: "SLR", therapist: "deepa",
    parents: { father: "Ravi K", mother: "Deepa R" }, clear: ["s5"],
    steps: [{ action: "APPROVE" },
      { action: "SEND_BACK", comment: "Please answer the diagnosis question again and fill in the development history, then submit." },
      { action: "SAVE", values: { s4_asd_diagnosed: null } }] },
  // Admitted, so the registration number exists and the reports have a row with a number
  { applicant: "Kavya S", nameTa: "காவ்யா", centre: "TVM", therapist: "priya",
    parents: { father: "Selvam M", mother: "Lakshmi S" },
    steps: [{ action: "APPROVE" }, { action: "APPROVE" }, { action: "ADMIT" }] },
]);
