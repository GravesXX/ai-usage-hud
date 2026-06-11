import type { NativeBridge } from "../../bridge/types";
import { codexActiveSession } from "../../core/active-session";
import { RateLimitedError, type ActiveSession, type LimitWindow, type TodayStats, type UsageProvider } from "../types";
import { loadCodexAuth } from "./auth";
import { codexJsonlFallback, fetchCodexLimits } from "./limits";
import { codexTodayStats } from "./today-stats";

export class CodexProvider implements UsageProvider {
  readonly id = "codex";
  readonly displayName = "Codex";
  caption?: string;

  constructor(private bridge: NativeBridge) {}

  async isConfigured(): Promise<boolean> {
    try { await loadCodexAuth(this.bridge); return true; } catch { return false; }
  }
  async fetchLimits(): Promise<LimitWindow[]> {
    const nowMs = Date.now();
    try {
      const auth = await loadCodexAuth(this.bridge);
      const result = await fetchCodexLimits(this.bridge, auth, nowMs);
      this.caption = result.planType;
      return result.windows;
    } catch (e) {
      if (e instanceof RateLimitedError) throw e; // honor cooldown, don't mask with stale fallback
      const fallback = await codexJsonlFallback(this.bridge, nowMs);
      if (fallback) return fallback;
      throw e;
    }
  }
  fetchTodayStats(): Promise<TodayStats> { return codexTodayStats(this.bridge, new Date()); }
  checkActiveSession(): Promise<ActiveSession> { return codexActiveSession(this.bridge); }
}
