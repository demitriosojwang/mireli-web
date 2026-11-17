"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoTile } from "@/components/site-chrome";

const DISMISS_KEY = "mireli-install-dismissed-at";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Install Mi-Reli" prompt for the passenger PWA.
 *
 * Chromium/Android: captures `beforeinstallprompt` and offers the native
 * install. iOS Safari has no such event, so it shows the Share →
 * "Add to Home Screen" instructions instead. Hidden when already installed
 * (standalone display mode). A dismissal silences it for the rest of the
 * visit but it reappears on the next visit until the app is installed.
 * Renders nothing on desktop browsers without an install prompt available.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // iOS has no beforeinstallprompt; it needs the manual Share-sheet hint.
  const [showIosHint] = useState(
    () =>
      typeof window !== "undefined" &&
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
      !/crios|fxios/i.test(window.navigator.userAgent)
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    // Same-session courtesy: after dismissing, do not re-show until the next
    // page load / visit. It always returns on a fresh visit until installed.
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      timer = setTimeout(() => setVisible(true), 1800);
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      reveal();
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (showIosHint) reveal();
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!visible || (!deferred && !showIosHint)) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    else dismiss();
    setDeferred(null);
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto w-auto max-w-md sm:left-auto sm:right-6 sm:mx-0 sm:w-96">
      <div className="flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-xl">
        <LogoTile size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install Mi-Reli</p>
          {showIosHint && !deferred ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Tap <Share className="inline h-3.5 w-3.5 align-[-2px]" /> Share, then
              “Add to Home Screen” — booking lives one tap away.
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Add Mi-Reli to your home screen for faster booking, one tap away.
            </p>
          )}
          {deferred && (
            <Button size="sm" className="mt-2.5" onClick={install}>
              <Download className="h-4 w-4" /> Install app
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
