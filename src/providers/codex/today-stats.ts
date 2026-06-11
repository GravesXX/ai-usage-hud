import type { NativeBridge } from "../../bridge/types";
import type { TodayStats } from "../types";

export function sessionsDirFor(home: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${home}/.codex/sessions/${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export async function codexTodayStats(bridge: NativeBridge, now: Date): Promise<TodayStats> {
  const home = await bridge.homeDir();
  const files = await bridge.listFilesRecursive(sessionsDirFor(home, now), ".jsonl");
  let total = 0;
  for (const f of files) {
    let content: string;
    try { content = await bridge.readTextFile(f.path); } catch { continue; }
    let maxCumulative = 0; // cumulative max per session, NOT event sum — guards replay overcount
    for (const line of content.split("\n")) {
      try {
        const t = JSON.parse(line)?.payload?.info?.total_token_usage?.total_tokens;
        if (typeof t === "number" && t > maxCumulative) maxCumulative = t;
      } catch { continue; }
    }
    total += maxCumulative;
  }
  return { tokens: total };
}
