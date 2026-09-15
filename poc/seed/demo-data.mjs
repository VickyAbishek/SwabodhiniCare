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
// taken by whichever person's role the application is waiting on at that moment. The comment on each
// case is the stage it must end at; tests/poc/seed.test.mjs holds the seed to it.
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
  // Sent back to the family, with the reason on the routing slip
  { applicant: "Meena R", nameTa: "மீனா", centre: "SLR", therapist: "deepa",
    parents: { father: "Ravi K", mother: "Deepa R" },
    steps: [{ action: "APPROVE" },
      { action: "SEND_BACK", comment: "The diagnosis report is missing its last page. Please attach the full report and submit again." }] },
  // Admitted, so the registration number exists and the reports have a row with a number
  { applicant: "Kavya S", nameTa: "காவ்யா", centre: "TVM", therapist: "priya",
    parents: { father: "Selvam M", mother: "Lakshmi S" },
    steps: [{ action: "APPROVE" }, { action: "APPROVE" }, { action: "ADMIT" }] },
]);
