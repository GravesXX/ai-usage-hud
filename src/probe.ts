import { NodeBridge } from "./bridge/node";
import { formatCountdown } from "./core/time";
import { createProviders } from "./providers/registry";

async function main() {
  const bridge = new NodeBridge();
  for (const p of createProviders(bridge)) {
    console.log(`\n=== ${p.displayName} (${p.id}) ===`);
    if (!(await p.isConfigured())) { console.log("  not configured"); continue; }
    try {
      const windows = await p.fetchLimits();
      if (p.caption) console.log(`  plan: ${p.caption}`);
      for (const w of windows) {
        const rem = w.resetsAt ? formatCountdown(new Date(w.resetsAt).getTime() - Date.now()) : "—";
        console.log(`  ${w.label.padEnd(14)} ${w.usedPercent.toFixed(1).padStart(5)}%   resets in ${rem}`);
      }
    } catch (e) { console.log(`  limits error: ${(e as Error).message}`); }
    try {
      const t = await p.fetchTodayStats();
      const cost = t.costUSD !== undefined && t.costUSD > 0 ? ` · ≈$${t.costUSD.toFixed(2)}` : "";
      console.log(`  today: ${t.tokens.toLocaleString()} tokens${cost}`);
    } catch (e) { console.log(`  stats error: ${(e as Error).message}`); }
    const a = await p.checkActiveSession();
    console.log(`  active session: ${a.active}${a.model ? ` (${a.model})` : ""}`);
  }
}
main();
