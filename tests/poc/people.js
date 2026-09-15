// Test helper: a POC server with one signed-in person per role (fictional staff).
const nodeCrypto = require("node:crypto");
const { createContext, plain } = require("./harness.js");

const sha = (text) => nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
const SALT = "0123456789abcdef0123456789abcdef";

const PEOPLE = Object.freeze({
  anand: ["ADMIN"],
  priya: ["THERAPIST"],
  deepa: ["THERAPIST"],
  lakshmi: ["THERAPY_HEAD"],
  suresh: ["CENTRE_HEAD"],
  revathi: ["DIRECTOR"],
});

function addPerson(ctx, name, roles) {
  const key = sha(`key-${name}`);
  ctx.SC_Store.insert("Users", {
    id: `u-${name}`, email: `${name}@example.com`, name: name[0].toUpperCase() + name.slice(1), roles,
    password_hash: sha(key), password_salt: SALT, kdf_iterations: 600000,
    is_active: true, failed_logins: 0, must_change_password: false,
  });
  return plain(ctx.SC_Api.handle({ action: "auth.login", data: { email: `${name}@example.com`, key } })).data.token;
}

// Returns { ctx, tokens, as } where as("priya")(action, data) calls the server as Priya.
function setupPeople(options = {}) {
  const ctx = createContext(Object.assign({}, options, {
    properties: Object.assign({ HMAC_SECRET: "test-secret" }, options.properties),
  }));
  ctx.SC_Store.ensureTabs();
  const tokens = {};
  for (const [name, roles] of Object.entries(PEOPLE)) tokens[name] = addPerson(ctx, name, roles);
  const as = (name) => (action, data) => plain(ctx.SC_Api.handle({ action, data, token: tokens[name] }));
  return { ctx, tokens, as };
}

module.exports = { setupPeople, PEOPLE, sha };
