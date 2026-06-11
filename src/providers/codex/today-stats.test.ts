import { describe, expect, it } from "vitest";
import { FakeBridge } from "../../bridge/fake";
import { codexJsonlFallback } from "./limits";
import { codexTodayStats, sessionsDirFor } from "./today-stats";

const NOW = new Date(2026, 5, 10, 14, 0);
const DIR = "/Users/test/.codex/sessions/2026/06/10";

function tokenCountLine(total: number, rateLimits: unknown = null) {
  return JSON.stringify({
    timestamp: NOW.toISOString(), type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: total } }, rate_limits: rateLimits },
  });
}

describe("sessionsDirFor", () => {
  it("zero-pads the date path", () => {
    expect(sessionsDirFor("/Users/test", new Date(2026, 5, 7))).toBe("/Users/test/.codex/sessions/2026/06/07");
  });
});

describe("codexTodayStats", () => {
  it("sums per-session cumulative MAX (guards the 91x replay overcount bug)", async () => {
    const b = new FakeBridge();
    // cumulative counter goes 100 -> 500 -> (replay) 300; max is 500, NOT 900
    b.files.set(`${DIR}/rollout-a.jsonl`, {
      content: [tokenCountLine(100), tokenCountLine(500), tokenCountLine(300)].join("\n"),
      mtimeMs: NOW.getTime(),
    });
    b.files.set(`${DIR}/rollout-b.jsonl`, { content: tokenCountLine(250), mtimeMs: NOW.getTime() });
    const stats = await codexTodayStats(b, NOW);
    expect(stats.tokens).toBe(750);
    expect(stats.costUSD).toBeUndefined(); // plan-based usage; no per-token cost
  });
  it("returns zero when today's dir is empty", async () => {
    expect((await codexTodayStats(new FakeBridge(), NOW)).tokens).toBe(0);
  });
});

describe("codexJsonlFallback", () => {
  it("returns newest non-null rate_limits snapshot, searching today then yesterday", async () => {
    const b = new FakeBridge();
    const snapshot = { primary: { used_percent: 33, window_minutes: 300, resets_at: 1781000000 }, secondary: null };
    b.files.set(`${DIR}/rollout-old.jsonl`, { content: tokenCountLine(1, null), mtimeMs: 1 });
    b.files.set(`${DIR}/rollout-new.jsonl`, {
      content: [tokenCountLine(1, null), tokenCountLine(2, snapshot)].join("\n"),
      mtimeMs: NOW.getTime(),
    });
    const w = await codexJsonlFallback(b, NOW.getTime());
    expect(w).not.toBeNull();
    expect(w![0]).toMatchObject({ id: "session", usedPercent: 33 });
  });
  it("returns null when all snapshots are null", async () => {
    const b = new FakeBridge();
    b.files.set(`${DIR}/rollout-a.jsonl`, { content: tokenCountLine(1, null), mtimeMs: NOW.getTime() });
    expect(await codexJsonlFallback(b, NOW.getTime())).toBeNull();
  });
});
