import type { NativeBridge } from "../bridge/types";
import { HttpError, RateLimitedError, type UsageProvider } from "../providers/types";
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
  private limitsInFlight = false;
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
        if (!Array.isArray(windows)) continue;
        this.hasData.add(p.id);
        this.update(p.id, { state: "stale", windows, asOf: typeof asOf === "number" ? asOf : null });
      } catch { /* corrupt cache — ignore, fresh poll will overwrite */ }
    }
  }

  async pollLimitsOnce(force = false): Promise<void> {
    if (this.limitsInFlight) return;
    this.limitsInFlight = true;
    try {
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
          try {
            await this.bridge.writeCache(`limits-${p.id}`, JSON.stringify({ windows, asOf: now }));
          } catch { /* cache persistence is best-effort; the ok view stands */ }
        } catch (e) {
          if (e instanceof RateLimitedError) {
            const cooldownSec = Math.min(e.retryAfterSec ?? 300, 3600);
            this.cooldownUntil.set(p.id, now + cooldownSec * 1000);
          }
          // A 401/403 is almost always the brief window where the CLI's short-lived
          // token is mid-refresh — calm, self-healing message rather than an alarm.
          // (It clears automatically on the next successful poll.)
          const note = e instanceof HttpError && (e.status === 401 || e.status === 403)
            ? "session expired — auto-refreshing"
            : (e as Error).message;
          this.update(p.id, { state: this.hasData.has(p.id) ? "stale" : "error", note });
        }
      }
    } finally {
      this.limitsInFlight = false;
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
