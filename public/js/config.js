// scope: shared
// App settings. For the deployed POC, set API_BASE to the Apps Script web app's /exec URL.
// In production: BACKEND "prod", API_BASE "/api", IS_DEMO false.
export const CONFIG = Object.freeze({
  BACKEND: "poc",
  API_BASE: "/api", // local dev server (poc/scripts/dev-server.mjs)
  IS_DEMO: true, // shows the "Test version: sample data only" banner [POC]
  KDF_ITERATIONS: 600000,
});
