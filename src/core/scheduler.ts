import type { NativeBridge } from "../bridge/types";
import { CredentialError, RateLimitedError, type UsageProvider } from "../providers/types";
import type { ProviderView } from "./store";

export interface SchedulerOpts {
  limitsMs?: number;  // network polls — 180s is the community-established safe cadence
  statsMs?: number;
  activeMs?: number;
  now?: () => number;
}
export type UpdateFn = (id: string, patch: Partial<ProviderView>) => void;

export class Scheduler {
  private cooldownUntil = new Map<string, number>();
  private hasData = new Set<string>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private limitsMs: number; private statsMs: number; private activeMs: number;
  private now: () => number;

  constructor(
    private providers: UsageProvider[],
    private bridge: NativeBridge,
    private update: UpdateFn,
    opts: SchedulerOpts = {},
  ) {
    this.limitsMs = opts.limitsMs ?? 180_000;
    this.statsMs = opts.statsMs ?? 60_000;
    this.activeMs = opts.activeMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {
    for (const p of this.providers) {
      this.update(p.id, {
        id: p.id, displayName: p.displayName, state: "unconfigured",
        windows: [], asOf: null, today: null, active: { active: false },
      });
    }
    await this.restoreFromCache();
    void this.pollLimitsOnce(); void this.pollStatsOnce(); void this.pollActiveOnce();
    this.timers = [
      setInterval(() => void this.pollLimitsOnce(), this.limitsMs),
      setInterval(() => void this.pollStatsOnce(), this.statsMs),
      setInterval(() => void this.pollActiveOnce(), this.activeMs),
    ];
  }
  stop(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }
  refreshNow(): void { void this.pollLimitsOnce(true); void this.pollStatsOnce(); void this.pollActiveOnce(); }

  async restoreFromCache(): Promise<void> {
    for (const p of this.providers) {
      try {
        const raw = await this.bridge.readCache(`limits-${p.id}`);
        if (!raw) continue;
        const { windows, asOf } = JSON.parse(raw);
        this.hasData.add(p.id);
        this.update(p.id, { state: "stale", windows, asOf });
      } catch { /* corrupt cache — ignore, fresh poll will overwrite */ }
    }
  }

  async pollLimitsOnce(force = false): Promise<void> {
    for (const p of this.providers) {
      const now = this.now();
      if (!force && (this.cooldownUntil.get(p.id) ?? 0) > now) continue;
      try {
        if (!(await p.isConfigured())) {
          if (!this.hasData.has(p.id)) this.update(p.id, { state: "unconfigured" });
          continue;
        }
        const windows = await p.fetchLimits();
        this.hasData.add(p.id);
        this.update(p.id, { state: "ok", windows, asOf: now, caption: p.caption, note: undefined });
        await this.bridge.writeCache(`limits-${p.id}`, JSON.stringify({ windows, asOf: now }));
      } catch (e) {
        if (e instanceof RateLimitedError) {
          this.cooldownUntil.set(p.id, now + (e.retryAfterSec ?? 300) * 1000);
        }
        const note = e instanceof CredentialError && e.reason === "expired"
          ? `re-auth in ${p.displayName}`
          : (e as Error).message;
        this.update(p.id, { state: this.hasData.has(p.id) ? "stale" : "error", note });
      }
    }
  }
  async pollStatsOnce(): Promise<void> {
    for (const p of this.providers) {
      try { this.update(p.id, { today: await p.fetchTodayStats() }); } catch { /* best-effort */ }
    }
  }
  async pollActiveOnce(): Promise<void> {
    for (const p of this.providers) {
      try { this.update(p.id, { active: await p.checkActiveSession() }); } catch { /* best-effort */ }
    }
  }
}
