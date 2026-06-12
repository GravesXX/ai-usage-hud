// Fetch live usage and EMIT the snapshot JSON to stdout (no protected writes).
// A signed, app-group-entitled helper (widget-sync) consumes stdout and writes
// it into the App Group container, so the unentitled Node process never touches
// "another app's data" and macOS never shows the App-Data prompt.
//
// Diagnostics go to stderr so stdout stays clean JSON.
import { NodeBridge } from "../src/bridge/node";
import { createProviders } from "../src/providers/registry";
import { buildSnapshot } from "../src/core/snapshot";
import { RateLimitedError, HttpError } from "../src/providers/types";
import type { ProviderView } from "../src/core/store";

function errNote(e: unknown): string {
  if (e instanceof RateLimitedError) return "rate limited — retrying";
  if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return "session expired — auto-refreshing";
  return (e as Error).message;
}

async function main() {
  const bridge = new NodeBridge();
  const views: ProviderView[] = [];
  for (const p of createProviders(bridge)) {
    const today = await p.fetchTodayStats().catch(() => null);
    try {
      const windows = await p.fetchLimits();
      views.push({ id: p.id, displayName: p.displayName, state: "ok", windows, asOf: Date.now(), today, active: { active: false }, caption: p.caption });
      console.error(`  ${p.id}: OK (${windows.length} windows)`);
    } catch (e) {
      const note = errNote(e);
      views.push({ id: p.id, displayName: p.displayName, state: "error", windows: [], asOf: null, today, active: { active: false }, note });
      console.error(`  ${p.id}: ${note}`);
    }
  }
  // stdout = clean snapshot JSON for the signed helper
  process.stdout.write(JSON.stringify(buildSnapshot(views, Date.now())));
}
main();
