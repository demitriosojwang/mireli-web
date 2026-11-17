"use client";

import { useState } from "react";
import { MessageSquarePlus, Send, X, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "problem", label: "Something went wrong" },
  { value: "complaint", label: "Complaint" },
  { value: "idea", label: "Suggestion" },
  { value: "compliment", label: "Compliment" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

/**
 * Floating feedback panel: a small tab pinned to the screen edge on every
 * passenger page. Opens a sheet where a customer — guest or signed-in — can
 * report a problem or raise a concern without logging in. Deliberately
 * unobtrusive: collapsed by default, remembers nothing once sent.
 */
export function FeedbackPanel() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("problem");
  const [message, setMessage] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState<string | null>(null);

  function openPanel() {
    setOpen(true);
    setPagePath(window.location.pathname);
  }

  async function send() {
    if (message.trim().length < 5) {
      setError("Tell us a little more (at least 5 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/feedback", {
        body: {
          category,
          message,
          page: pagePath,
          bookingId: bookingRef.trim() || undefined,
        },
      });
      setSent(true);
      setMessage("");
      setBookingRef("");
      setTimeout(() => {
        setSent(false);
        setOpen(false);
      }, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Edge tab — always visible when collapsed, clear of the safe areas */}
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Give feedback or report a problem"
          className="fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-xl border border-l-0 border-border bg-card/95 px-1.5 py-3 shadow-lg backdrop-blur transition-transform hover:translate-x-0.5"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Feedback panel"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border bg-card p-4 shadow-2xl sm:left-auto sm:right-4 sm:mx-0 sm:w-96"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Feedback &amp; support</h2>
              <p className="text-xs text-muted-foreground">
                Report a problem or tell us what to improve. No login needed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close feedback panel"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {sent ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              Thank you — your message reached the Mi-Reli team.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                      category === c.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setError(null);
                }}
                maxLength={2000}
                rows={4}
                placeholder={category === "problem" ? "What happened? Which step were you on?" : "Tell us more…"}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />

              <Input
                type="text"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                placeholder="Booking code (optional) — e.g. MR-ABC123"
                className="h-9 text-xs"
              />

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button className="h-10 w-full" onClick={send} disabled={busy || message.trim().length < 5}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send to Mi-Reli
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                Urgent ride problem? Call support on the number in your booking confirmation.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
