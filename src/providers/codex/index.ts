import type { NativeBridge } from "../../bridge/types";
import { codexActiveSession } from "../../core/active-session";
import { CredentialError, RateLimitedError, type ActiveSession, type LimitWindow, type TodayStats, type UsageProvider } from "../types";
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
      // Re-throw cooldowns and broken-auth so the user is told to re-auth, instead of
      // masking them with stale local data. Only endpoint/network failures fall back.
      if (e instanceof RateLimitedError || e instanceof CredentialError) throw e;
      const fallback = await codexJsonlFallback(this.bridge, nowMs);
      if (fallback) return fallback;
      throw e;
    }
  }
  fetchTodayStats(): Promise<TodayStats> { return codexTodayStats(this.bridge, new Date()); }
  checkActiveSession(): Promise<ActiveSession> { return codexActiveSession(this.bridge); }
}
