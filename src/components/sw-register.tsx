"use client";

import { useEffect } from "react";

/**
 * Registers the Mi-Reli service worker from inside the bundle.
 *
 * The previous static `<script src="/sw-register.js">` tag was silently blocked
 * by the nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'` ignores host
 * allowlists), so the PWA never registered in production. Registering here —
 * from first-party bundle code the CSP already trusts — restores it.
 * Registration failure stays non-fatal: the app is fully functional online.
 */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
