// One-off: fetch live provider data and write the widget snapshot into the
// App Group container. Used by the Task 8 write-access spike, and handy for
// manually refreshing the widget when only the probe (not the app) has run.
import { NodeBridge } from "../src/bridge/node";
import { createProviders } from "../src/providers/registry";
import { publishSnapshot } from "../src/core/snapshot";
import type { ProviderView } from "../src/core/store";
import { RateLimitedError, HttpError } from "../src/providers/types";

function errNote(e: unknown): string {
  if (e instanceof RateLimitedError) return "rate limited — retrying";
  if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return "session expired — auto-refreshing";
  return (e as Error).message;
}

async function main() {
  const bridge = new NodeBridge();
  const views: ProviderView[] = [];
  for (const p of createProviders(bridge)) {
    // Today's stats come from local logs and work even when limits are rate-limited.
    const today = await p.fetchTodayStats().catch(() => null);
    try {
      const windows = await p.fetchLimits();
      views.push({ id: p.id, displayName: p.displayName, state: "ok", windows, asOf: Date.now(), today, active: { active: false }, caption: p.caption });
      console.log(`  ${p.id}: OK (${windows.length} windows)`);
    } catch (e) {
      const note = errNote(e);
      views.push({ id: p.id, displayName: p.displayName, state: "error", windows: [], asOf: null, today, active: { active: false }, note });
      console.log(`  ${p.id}: ${note}`);
    }
  }
  await publishSnapshot(bridge, views, Date.now());
  console.log("wrote snapshot for", views.map((v) => v.id).join(", "));
}
main();
