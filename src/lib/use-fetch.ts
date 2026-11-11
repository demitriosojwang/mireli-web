"use client";
/**
 * The one fetch machine. Every client fetch used to hand-roll its own
 * null/loading/error triple with different semantics; they all use this now.
 *
 * States (explicit, mutually consistent by construction):
 *  - loading:  status === "loading"
 *  - ready:    status === "ready"   (data non-null)
 *  - error:    status === "error"   (data may still hold stale values)
 *  - empty:    status === "ready" with data resolving to an empty set
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

export type FetchStatus = "loading" | "ready" | "error";

export interface FetchState<T> {
  data: T | null;
  status: FetchStatus;
  error: string | null;
  /** True while a background refresh runs after an initial successful load. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useFetch<T>(path: string | null, options?: { enabled?: boolean }): FetchState<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!path || !enabled) return;
    const seq = ++seqRef.current;
    // First load shows a skeleton; later refreshes keep stale data on screen.
    if (hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      // Fresh load: clear any previous path's data synchronously here rather
      // than in the effect (react-hooks/set-state-in-effect).
      setStatus("loading");
      setData(null);
      setError(null);
    }
    try {
      const res = await api<T>(path);
      if (seq !== seqRef.current) return; // a newer request superseded this one
      setData(res);
      setStatus("ready");
      setError(null);
      hasLoadedRef.current = true;
    } catch (e) {
      if (seq !== seqRef.current) return;
      // Keep stale data if we have it; only a first-load failure is a hard error.
      if (!hasLoadedRef.current) {
        setStatus("error");
        setData(null);
      }
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (seq === seqRef.current) setRefreshing(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    // Deferred one tick so the effect body itself performs no synchronous
    // state writes (react-hooks/set-state-in-effect).
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { data, status, error, refreshing, refresh };
}
