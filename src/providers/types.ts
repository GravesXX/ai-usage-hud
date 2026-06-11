export interface LimitWindow {
  id: string;            // 'session' | 'weekly' | 'weekly-opus' | ...
  label: string;
  usedPercent: number;   // 0-100 clamped
  resetsAt?: string;     // ISO
}
export interface TodayStats { tokens: number; costUSD?: number; byModel?: Record<string, number> }
export interface ActiveSession { active: boolean; model?: string }
export type ProviderState = "ok" | "stale" | "unconfigured" | "error";

export interface UsageProvider {
  id: string;
  displayName: string;
  /** Small caption shown next to the name, e.g. plan type "max"/"plus". Set by fetchLimits. */
  caption?: string;
  isConfigured(): Promise<boolean>;
  fetchLimits(): Promise<LimitWindow[]>;
  fetchTodayStats(): Promise<TodayStats>;
  checkActiveSession(): Promise<ActiveSession>;
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSec: number | null) { super("rate-limited"); }
}
export class HttpError extends Error {
  constructor(public status: number) { super(`http-${status}`); }
}
export class CredentialError extends Error {
  constructor(public reason: "not-found" | "expired" | "malformed") { super(`credential-${reason}`); }
}

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
