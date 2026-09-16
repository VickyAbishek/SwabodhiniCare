// scope: shared
// The screens' only way to reach the server. Which back end is used comes from config.js,
// so moving from the POC to production changes nothing here or in the screens.
const BACKENDS = ["poc", "prod"];
const SIGNED_OUT_CODES = ["NOT_SIGNED_IN", "SESSION_EXPIRED"];

export async function loadTransport(config, env) {
  if (!BACKENDS.includes(config.BACKEND)) throw new Error(`Unknown back end: ${config.BACKEND}`);
  const adapter = await import(`./backends/${config.BACKEND}.js`);
  return adapter.createTransport({ apiBase: config.API_BASE, fetchImpl: env.fetch, storage: env.storage });
}

export function createApi(transport, options = {}) {
  async function call(action, data) {
    const result = await transport.send(action, data);
    if (action === "auth.login" && result.ok) transport.setToken(result.data.token);
    if (action === "auth.logout") transport.clearToken();
    if (!result.ok && SIGNED_OUT_CODES.includes(result.error.code)) {
      transport.clearToken();
      if (options.onSignedOut) options.onSignedOut(result.error.code);
    }
    return result;
  }

  return Object.freeze({ call, isSignedIn: () => Boolean(transport.getToken()) });
}
