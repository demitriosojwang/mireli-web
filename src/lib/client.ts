"use client";

import { useCallback, useEffect, useState } from "react";

export interface Me {
  session: { id: string; name: string; identifier: string } | null;
  passenger?: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    idType: string | null;
    idNumber: string | null;
    nationality: string | null;
    gender: string | null;
    isGuest: boolean;
    guestUsed: boolean;
  };
  creditBalance?: number;
  activeCredits?: number;
}

/** The Primary Passenger details collected by the booking form. Shared by the
 *  booking sheet and the signup sheet (which must repeat the exact same
 *  details to create a Mi-Reli account). */
export interface PassengerDetails {
  fullName: string;
  idType: "id" | "passport";
  idNumber: string;
  nationality: string;
  gender: string;
  email: string;
  phone: string;
}

export function detailsComplete(d: PassengerDetails): boolean {
  return (
    d.fullName.trim().length >= 2 &&
    d.fullName.trim().includes(" ") &&
    d.idNumber.trim().length >= 4 &&
    d.nationality.trim() !== "" &&
    d.gender.trim() !== "" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim()) &&
    isValidMpesaPhone(d.phone)
  );
}

/** Loose client-side check mirroring the server's toMpesaMsISDN. */
export function isValidMpesaPhone(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  return /^(?:254|0)?(?:7|1)\d{8}$/.test(digits);
}

export class ApiTimeoutError extends Error {
  constructor() {
    super("Request timed out. Please try again.");
    this.name = "ApiTimeoutError";
  }
}

export async function api<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number }
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = options?.signal;
  const relayCallerAbort = () => controller.abort();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (callerSignal?.aborted) {
    relayCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", relayCallerAbort, { once: true });
  }

  if (options?.timeoutMs && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
  }

  try {
    const res = await fetch(path, {
      method: options?.method || (options?.body ? "POST" : "GET"),
      headers: options?.body ? { "Content-Type": "application/json" } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await res.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    }
    return data as T;
  } catch (error) {
    if (timedOut) throw new ApiTimeoutError();
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", relayCallerAbort);
  }
}

/** Passenger session hook — refreshes on demand. */
let pendingIdentity: Promise<Me> | null = null;
function fetchIdentity() {
  // Several mounted screens need the same guest cookie. Deduplicate their
  // first request so one browser visit does not create multiple guest records.
  pendingIdentity ??= api<Me>("/api/me").finally(() => { pendingIdentity = null; });
  return pendingIdentity;
}
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIdentity();
      setMe(data);
      return true;
    } catch {
      setMe(null);
      setError("We couldn't start your secure booking session. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchIdentity().then((data) => { if (active) setMe(data); })
      .catch(() => {
        if (active) {
          setMe(null);
          setError("We couldn't start your secure booking session. Please try again.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { me, loading, error, refresh };
}

export const DIRECTION_LABELS: Record<string, string> = {
  FROM_TERMINUS: "From the SGR Terminus",
  TO_TERMINUS: "To the SGR Terminus",
};
