// One-off: fetch live provider data and write the widget snapshot into the
// App Group container. Used by the Task 8 write-access spike, and handy for
// manually refreshing the widget when only the probe (not the app) has run.
import { NodeBridge } from "../src/bridge/node";
import { createProviders } from "../src/providers/registry";
import { publishSnapshot } from "../src/core/snapshot";
import type { ProviderView } from "../src/core/store";

async function main() {
  const bridge = new NodeBridge();
  const views: ProviderView[] = [];
  for (const p of createProviders(bridge)) {
    try {
      const windows = await p.fetchLimits();
      const today = await p.fetchTodayStats().catch(() => null);
      views.push({ id: p.id, displayName: p.displayName, state: "ok", windows, asOf: Date.now(), today, active: { active: false }, caption: p.caption });
    } catch {
      views.push({ id: p.id, displayName: p.displayName, state: "error", windows: [], asOf: null, today: null, active: { active: false } });
    }
  }
  await publishSnapshot(bridge, views, Date.now());
  console.log("wrote snapshot for", views.map((v) => v.id).join(", "));
}
main();
