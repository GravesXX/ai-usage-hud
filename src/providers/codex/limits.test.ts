import { describe, expect, it } from "vitest";
import wham from "../../../fixtures/codex-wham-usage.json";
import { FakeBridge } from "../../bridge/fake";
import { HttpError } from "../types";
import { fetchCodexLimits, normalizeCodexWindows } from "./limits";

const CAPTURED = 1780900000_000; // ms

describe("normalizeCodexWindows", () => {
  it("handles REST wham shape (limit_window_seconds + reset_at epoch sec)", () => {
    const w = normalizeCodexWindows(
      { primary: wham.rate_limit.primary_window, secondary: wham.rate_limit.secondary_window },
      CAPTURED,
    );
    expect(w).toEqual([
      { id: "session", label: "5-hour", usedPercent: 47.5, resetsAt: new Date(1781000000_000).toISOString() },
      { id: "weekly", label: "Weekly", usedPercent: 12.1, resetsAt: new Date(1781400000_000).toISOString() },
    ]);
  });
  it("handles JSONL snapshot shape (window_minutes + resets_at)", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 10, window_minutes: 300, resets_at: 1781000000 }, secondary: null },
      CAPTURED,
    );
    expect(w).toEqual([
      { id: "session", label: "5-hour", usedPercent: 10, resetsAt: new Date(1781000000_000).toISOString() },
    ]);
  });
  it("handles legacy resets_in_seconds relative to capture time", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 5, window_minutes: 300, resets_in_seconds: 60 }, secondary: null },
      CAPTURED,
    );
    expect(w[0].resetsAt).toBe(new Date(CAPTURED + 60_000).toISOString());
  });
  it("handles websocket shape (reset_after_seconds + reset_at)", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 1, window_minutes: 300, reset_after_seconds: 18000, reset_at: 1780904804 }, secondary: null },
      CAPTURED,
    );
    expect(w[0].resetsAt).toBe(new Date(1780904804_000).toISOString());
  });
  it("classifies by window_minutes when present, position otherwise", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 1, window_minutes: 10080 }, secondary: { used_percent: 2, window_minutes: 300 } },
      CAPTURED,
    );
    expect(w[0].id).toBe("weekly");
    expect(w[1].id).toBe("session");
  });
});

describe("fetchCodexLimits", () => {
  it("sends bearer + account id headers and normalizes", async () => {
    const b = new FakeBridge();
    b.fetchHandler = (url, init) => {
      expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
      expect(init.headers?.["Authorization"]).toBe("Bearer at-123");
      expect(init.headers?.["ChatGPT-Account-Id"]).toBe("acct-9");
      return { status: 200, headers: {}, bodyText: JSON.stringify(wham) };
    };
    const r = await fetchCodexLimits(b, { accessToken: "at-123", accountId: "acct-9" }, CAPTURED);
    expect(r.windows).toHaveLength(2);
    expect(r.planType).toBe("plus");
  });
  it("throws HttpError on failure", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 401, headers: {}, bodyText: "" });
    await expect(fetchCodexLimits(b, { accessToken: "x", accountId: "y" }, CAPTURED)).rejects.toThrow(HttpError);
  });
});
