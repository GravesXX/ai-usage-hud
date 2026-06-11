import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/claude-usage.json";
import { FakeBridge } from "../../bridge/fake";
import { HttpError, RateLimitedError } from "../types";
import { fetchClaudeLimits, parseClaudeUsage } from "./limits";

describe("parseClaudeUsage", () => {
  it("maps windows, parses string utilization, skips zero opus window", () => {
    const windows = parseClaudeUsage(fixture);
    expect(windows).toEqual([
      { id: "session", label: "Session", usedPercent: 62, resetsAt: "2026-06-10T18:00:00.000Z" },
      { id: "weekly", label: "Weekly", usedPercent: 28.4, resetsAt: "2026-06-14T07:00:00.000Z" },
    ]);
  });
  it("includes opus window when non-zero", () => {
    const w = parseClaudeUsage({ seven_day_opus: { utilization: 12, resets_at: "2026-06-14T07:00:00Z" } });
    expect(w).toEqual([
      { id: "weekly-opus", label: "Weekly (Opus)", usedPercent: 12, resetsAt: "2026-06-14T07:00:00.000Z" },
    ]);
  });
  it("clamps and tolerates junk", () => {
    const w = parseClaudeUsage({ five_hour: { utilization: 250, resets_at: "not-a-date" } });
    expect(w).toEqual([{ id: "session", label: "Session", usedPercent: 100, resetsAt: undefined }]);
  });
});

describe("fetchClaudeLimits", () => {
  const creds = { accessToken: "tok", expiresAt: 0 };
  it("sends required headers", async () => {
    const b = new FakeBridge();
    let seen: Record<string, string> = {};
    b.fetchHandler = (url, init) => {
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
      seen = init.headers ?? {};
      return { status: 200, headers: {}, bodyText: JSON.stringify(fixture) };
    };
    await fetchClaudeLimits(b, creds, "2.1.5");
    expect(seen["Authorization"]).toBe("Bearer tok");
    expect(seen["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(seen["User-Agent"]).toBe("claude-code/2.1.5");
  });
  it("throws RateLimitedError with Retry-After on 429", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 429, headers: { "retry-after": "120" }, bodyText: "" });
    await expect(fetchClaudeLimits(b, creds, "2.1.5")).rejects.toThrow(RateLimitedError);
    await fetchClaudeLimits(b, creds, "2.1.5").catch((e) => expect(e.retryAfterSec).toBe(120));
  });
  it("throws HttpError otherwise", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 403, headers: {}, bodyText: "" });
    await expect(fetchClaudeLimits(b, creds, "2.1.5")).rejects.toThrow(HttpError);
  });
});
