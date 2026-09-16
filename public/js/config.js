// scope: shared
// App settings. For the deployed POC, set API_BASE to the Apps Script web app's /exec URL —
// scripts/prepare-deploy.mjs writes config.deploy.js, which is spread over these defaults below.
// In production: BACKEND "prod", API_BASE "/api", IS_DEMO false, SAMPLE_DATA "".
import { DEPLOY } from "./config.deploy.js";

export const DEFAULTS = Object.freeze({
  BACKEND: "poc",
  API_BASE: "/api", // local dev server (poc/scripts/dev-server.mjs)
  IS_DEMO: true, // shows the "Test version: sample data only" banner [POC]
  // [POC] The invented answers behind "Fill with sample data", named the same way as BACKEND so
  // that no shared screen has to know where POC code lives. Empty means the button is hidden.
  SAMPLE_DATA: "seed/sample-applications",
  KDF_ITERATIONS: 600000,
});

// Merges deploy-time overrides over the defaults without mutating either. Frozen so no screen
// can change settings at runtime.
export function buildConfig(deploy = {}) {
  return Object.freeze({ ...DEFAULTS, ...deploy });
}

export const CONFIG = buildConfig(DEPLOY);
