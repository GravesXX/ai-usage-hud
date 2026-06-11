import type { NativeBridge } from "../../bridge/types";
import { claudeActiveSession } from "../../core/active-session";
import { CredentialError, type ActiveSession, type LimitWindow, type TodayStats, type UsageProvider } from "../types";
import { loadClaudeCredentials } from "./credentials";
import { fetchClaudeLimits } from "./limits";
import { claudeTodayStats } from "./today-stats";

const FALLBACK_CLI_VERSION = "2.1.5";

export class ClaudeCodeProvider implements UsageProvider {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";
  caption?: string;
  private cliVersion: string | null = null;

  constructor(private bridge: NativeBridge) {}

  async isConfigured(): Promise<boolean> {
    try { await loadClaudeCredentials(this.bridge); return true; } catch { return false; }
  }
  async fetchLimits(): Promise<LimitWindow[]> {
    const creds = await loadClaudeCredentials(this.bridge);
    if (creds.expiresAt > 0 && creds.expiresAt < Date.now()) throw new CredentialError("expired");
    this.caption = creds.subscriptionType;
    if (!this.cliVersion) this.cliVersion = (await this.bridge.getCliVersion("claude")) ?? FALLBACK_CLI_VERSION;
    return fetchClaudeLimits(this.bridge, creds, this.cliVersion);
  }
  fetchTodayStats(): Promise<TodayStats> { return claudeTodayStats(this.bridge, new Date()); }
  checkActiveSession(): Promise<ActiveSession> { return claudeActiveSession(this.bridge, Date.now()); }
}
