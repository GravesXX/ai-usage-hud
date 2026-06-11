import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ActiveSession, LimitWindow, ProviderState, TodayStats } from "../providers/types";

export interface ProviderView {
  id: string;
  displayName: string;
  state: ProviderState;
  windows: LimitWindow[];
  asOf: number | null;          // ms of last successful limits fetch
  today: TodayStats | null;
  active: ActiveSession;
  caption?: string;             // e.g. "max" / "plus"
  note?: string;                // e.g. "re-auth in Claude Code"
}

export interface HudState {
  providers: Record<string, ProviderView>;
  upsert(id: string, patch: Partial<ProviderView>): void;
}

export const hudStore = createStore<HudState>((set) => ({
  providers: {},
  upsert: (id, patch) =>
    set((s) => {
      const prev: ProviderView = s.providers[id] ?? {
        id, displayName: id, state: "unconfigured",
        windows: [], asOf: null, today: null, active: { active: false },
      };
      return { providers: { ...s.providers, [id]: { ...prev, ...patch } } };
    }),
}));

export function useHud<T>(selector: (s: HudState) => T): T {
  return useStore(hudStore, selector);
}
