/**
 * Simulation is restricted to an explicitly enabled, non-Vercel dev server, or
 * to a self-hosted container that opts in a second time.
 *
 * MIRELI_DEMO_MODE alone only unlocks the local dev server. The self-hosted
 * Docker image runs the production build, so it also has to assert
 * MIRELI_ALLOW_UNSAFE_DEMO=true to reach the same prototype boundary. Two
 * independent flags mean a stray MIRELI_DEMO_MODE copied into a real
 * deployment can never silently switch on prototype login and simulated money.
 */
export function isLocalDemoEnabled(): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.MIRELI_DEMO_MODE !== "true") return false;
  if (process.env.NODE_ENV === "development") return true;
  return process.env.NODE_ENV === "production" && process.env.MIRELI_ALLOW_UNSAFE_DEMO === "true";
}

export function resolvePaymentMode(complete: boolean, forcedMock: boolean): "mock" | "live" {
  if (forcedMock || !complete) {
    if (!isLocalDemoEnabled()) {
      throw new Error("M-Pesa is not configured. Simulated payments are restricted to the local demo.");
    }
    return "mock";
  }
  return "live";
}
