// scope: shared
/* What the decision screen may say about the registration number before it is issued (main spec §5,
   scope map F13). The server mints the number inside the lock, from a per-centre, per-year counter
   the phone cannot read, and only when an application is admitted — so the screen may show the part
   that is already decided (the school's prefix, the centre and the year) and must leave the sequence
   to the server. Nothing here can be wrong; the number the report carries is the one
   applications.decide returns, and the confirmation that follows shows exactly that.
   Pure: numbers and today come in, so it is testable without a browser. */
const SEQUENCE_LENGTH = 4; // SC_Numbers builds the sequence as the last four characters
const OPEN = "…"; // the sequence, still the server's to choose

export function createRegPreview({ numbers, today }) {
  // The school's year, as the number itself takes it: a decision just after midnight in Chennai is
  // still yesterday in UTC, and this year goes into a number the family keeps.
  function year() {
    return Number(today().slice(0, 4));
  }

  // { labelKey, value, hintKey } for the field above the password. The label and the hint are keys
  // for the screen to translate; the value is what is known. Returns null when there is nothing
  // honest to show — a file without a centre the number format knows.
  function show(app) {
    // A number already issued stands: a reopened file that has come back to the Director's desk
    // keeps it (decision #5), so there is no preview to make — this is the number.
    if (app.registrationNo) {
      return { labelKey: "decide.registrationNumber", value: app.registrationNo, hintKey: "" };
    }
    let prefix;
    try {
      prefix = numbers.formatRegNo(app.centre, year(), 1).slice(0, -SEQUENCE_LENGTH);
    } catch (err) {
      return null; // no centre, or one the school has no code for
    }
    return { labelKey: "decide.regNo", value: prefix + OPEN, hintKey: "decide.regNoPreview" };
  }

  return Object.freeze({ show });
}
