import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiTimeoutError, api } from "@/lib/client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client API request deadlines", () => {
  it("aborts a stalled request and reports a retryable timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = api("/api/stages?q=mt", { timeoutMs: 250 });
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(250);
    await assertion;

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps caller cancellation distinct from a request timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = new AbortController();
    const pending = api("/api/stages?q=mt", { signal: caller.signal, timeoutMs: 1_000 });
    const assertion = expect(pending).rejects.not.toBeInstanceOf(ApiTimeoutError);
    caller.abort();
    await assertion;

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
