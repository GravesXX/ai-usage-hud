import type { NativeBridge } from "../bridge/types";
import type { ProviderState } from "../providers/types";
import type { ProviderView } from "./store";

export interface WindowSnapshot { label: string; usedPercent: number; resetsAt?: string }
export interface TodaySnapshot { tokens: number; costUSD?: number }
export interface ProviderSnapshot {
  id: string;
  displayName: string;
  state: ProviderState;
  caption?: string;
  windows: WindowSnapshot[];
  today?: TodaySnapshot;
  note?: string;            // why a provider has no fresh bars, e.g. "rate limited — retrying"
}
export interface UsageSnapshot {
  version: number;
  updatedAt: number;
  providers: ProviderSnapshot[];
}

export const SNAPSHOT_VERSION = 1;

/** Pure projection of store views to the cross-language widget contract. */
export function buildSnapshot(views: ProviderView[], now: number): UsageSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    updatedAt: now,
    providers: views.map((v) => ({
      id: v.id,
      displayName: v.displayName,
      state: v.state,
      caption: v.caption,
      windows: v.windows.map((w) => ({ label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt })),
      today: v.today ? { tokens: v.today.tokens, costUSD: v.today.costUSD } : undefined,
      note: v.note,
    })),
  };
}

/** Build + write the snapshot to the App Group container. Best-effort. */
export async function publishSnapshot(bridge: NativeBridge, views: ProviderView[], now: number): Promise<void> {
  await bridge.writeGroupSnapshot(JSON.stringify(buildSnapshot(views, now)));
}
