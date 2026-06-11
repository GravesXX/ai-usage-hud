import { describe, expect, it } from "vitest";
import { FakeBridge } from "../../bridge/fake";
import { claudeTodayStats } from "./today-stats";

const NOW = new Date(2026, 5, 10, 14, 0); // June 10 local
const iso = NOW.toISOString();

function line(id: string, reqId: string, model: string, inTok: number, outTok: number, ts = iso) {
  return JSON.stringify({
    type: "assistant", timestamp: ts, requestId: reqId,
    message: { id, model, usage: { input_tokens: inTok, output_tokens: outTok, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

describe("claudeTodayStats", () => {
  it("sums today's tokens by model and dedupes by message.id+requestId", async () => {
    const b = new FakeBridge();
    const content = [
      line("m1", "r1", "claude-opus-4-6", 100, 50),
      line("m1", "r1", "claude-opus-4-6", 100, 50), // duplicate — must not double count
      line("m2", "r2", "claude-haiku-4-5", 10, 5),
      "not json at all", // malformed lines skipped
      line("m3", "r3", "claude-opus-4-6", 1, 1, new Date(2026, 5, 9).toISOString()), // yesterday — excluded
    ].join("\n");
    b.files.set("/Users/test/.claude/projects/p1/s1.jsonl", { content, mtimeMs: NOW.getTime() });
    const stats = await claudeTodayStats(b, NOW);
    expect(stats.tokens).toBe(165);
    expect(stats.byModel).toEqual({ "claude-opus-4-6": 150, "claude-haiku-4-5": 15 });
    // 100in/50out opus@5/25 = 0.0005+0.00125; 10in/5out haiku@1/5 = 0.00001+0.000025
    expect(stats.costUSD).toBeCloseTo(0.001785, 6);
  });
  it("returns zeros when no files", async () => {
    const stats = await claudeTodayStats(new FakeBridge(), NOW);
    expect(stats).toEqual({ tokens: 0, costUSD: 0, byModel: {} });
  });
});
