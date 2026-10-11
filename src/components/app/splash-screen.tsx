"use client";

import { useEffect, useState } from "react";

/**
 * Mi-Reli splash — navy coast gradient, orange sunset sweep, bounce-in logo.
 * Shows once per browser session so navigation doesn't replay it.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), 2200);
    const doneTimer = setTimeout(onDone, 2700); // exit animation is 0.5s
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center ${
        exiting ? "mireli-splash-out" : ""
      }`}
      style={{
        background: `
          radial-gradient(ellipse at top, oklch(0.32 0.08 258), oklch(0.20 0.06 258)),
          linear-gradient(180deg, oklch(0.25 0.07 258) 0%, oklch(0.18 0.05 258) 100%)
        `,
      }}
    >
      {/* Decorative top arc — orange sweep like a sunset */}
      <div
        className="absolute left-0 right-0 top-0 h-1/3 opacity-20"
        style={{
          background:
            "radial-gradient(ellipse at center top, oklch(0.67 0.19 42 / 0.6), transparent 70%)",
        }}
      />

      {/* Supplied full brand lockup with bounce-in animation */}
      <div className="mireli-splash-in relative z-10 flex flex-col items-center">
        <div
          className="mb-6 h-48 w-48 overflow-hidden rounded-3xl bg-white shadow-2xl"
          style={{ boxShadow: "0 0 60px oklch(0.67 0.19 42 / 0.4)" }}
        >
          <img src="/mireli-logo.jpeg" alt="Mi-Reli" className="h-full w-full object-contain" />
        </div>

        {/* Tagline */}
        <p className="text-sm uppercase tracking-[0.3em] text-white/60">Ride · Connect · Journey</p>
      </div>

      {/* Shimmer loading bar */}
      <div className="absolute bottom-32 h-1 w-48 overflow-hidden rounded-full bg-white/10">
        <div className="mireli-shimmer h-full w-full rounded-full" />
      </div>

      {/* Bottom text */}
      <div className="absolute bottom-16 text-center">
        <p className="text-[10px] uppercase tracking-wider text-white/40">
          Mombasa Terminus · Kenya Coast
        </p>
      </div>
    </div>
  );
}

/** Hook: show the splash once per browser session. */
export function useSplashOnce(): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Deferred so we don't call setState synchronously inside the effect.
    const t = setTimeout(() => {
      if (!window.sessionStorage.getItem("mireli-splash-seen")) {
        window.sessionStorage.setItem("mireli-splash-seen", "1");
        setShow(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return show;
}
