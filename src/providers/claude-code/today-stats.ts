import type { NativeBridge } from "../../bridge/types";
import { localDayKey, startOfTodayMs } from "../../core/time";
import type { TodayStats } from "../types";
import { priceFor } from "./pricing";

export async function claudeTodayStats(bridge: NativeBridge, now: Date): Promise<TodayStats> {
  const home = await bridge.homeDir();
  const files = await bridge.listFilesRecursive(`${home}/.claude/projects`, ".jsonl", startOfTodayMs(now));
  const today = localDayKey(now);
  const seen = new Set<string>();
  const byModel: Record<string, number> = {};
  let cost = 0;

  for (const f of files) {
    let content: string;
    try { content = await bridge.readTextFile(f.path); } catch { continue; }
    for (const lineText of content.split("\n")) {
      let entry: any;
      try { entry = JSON.parse(lineText); } catch { continue; }
      const usage = entry?.message?.usage;
      if (!usage || typeof entry.timestamp !== "string") continue;
      if (localDayKey(new Date(entry.timestamp)) !== today) continue;
      const key = `${entry.message.id ?? ""}:${entry.requestId ?? ""}`;
      if (key !== ":" && seen.has(key)) continue;
      seen.add(key);
      const model: string = entry.message.model ?? "unknown";
      const inTok = usage.input_tokens ?? 0;
      const outTok = usage.output_tokens ?? 0;
      const cacheW = usage.cache_creation_input_tokens ?? 0;
      const cacheR = usage.cache_read_input_tokens ?? 0;
      byModel[model] = (byModel[model] ?? 0) + inTok + outTok + cacheW + cacheR;
      const p = priceFor(model);
      cost += (inTok * p.in + outTok * p.out + cacheW * p.cacheWrite + cacheR * p.cacheRead) / 1_000_000;
    }
  }
  const tokens = Object.values(byModel).reduce((a, b) => a + b, 0);
  return { tokens, costUSD: cost, byModel };
}
