import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import type { ActiveSession, LimitWindow, TodayStats, UsageProvider } from "../providers/types";
import { CredentialError, RateLimitedError } from "../providers/types";
import { Scheduler } from "./scheduler";
import type { ProviderView } from "./store";

class FakeProvider implements UsageProvider {
  id = "fake"; displayName = "Fake"; caption?: string;
  configured = true;
  fetchCount = 0;
  limitsImpl: () => Promise<LimitWindow[]> = async () => [{ id: "session", label: "S", usedPercent: 1 }];
  async isConfigured() { return this.configured; }
  async fetchLimits() { this.fetchCount++; return this.limitsImpl(); }
  async fetchTodayStats(): Promise<TodayStats> { return { tokens: 5 }; }
  async checkActiveSession(): Promise<ActiveSession> { return { active: true }; }
}

function harness(now = 1_000_000) {
  const provider = new FakeProvider();
  const bridge = new FakeBridge();
  const views = new Map<string, Partial<ProviderView>>();
  const clock = { now };
  const scheduler = new Scheduler([provider], bridge, (id, patch) => {
    views.set(id, { ...views.get(id), ...patch });
  }, { now: () => clock.now });
  return { provider, bridge, views, clock, scheduler };
}

describe("Scheduler.pollLimitsOnce", () => {
  it("ok path: updates view and writes cache", async () => {
    const { bridge, views, scheduler } = harness();
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("ok");
    expect(JSON.parse(bridge.cache.get("limits-fake")!).windows).toHaveLength(1);
  });
  it("error with no prior data -> error state", async () => {
    const { provider, views, scheduler } = harness();
    provider.limitsImpl = async () => { throw new Error("boom"); };
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("error");
  });
  it("success then failure -> stale with note for expired creds", async () => {
    const { provider, views, scheduler } = harness();
    await scheduler.pollLimitsOnce();
    provider.limitsImpl = async () => { throw new CredentialError("expired"); };
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("stale");
    expect(views.get("fake")!.note).toBe("re-auth in Fake");
  });
  it("429 sets cooldown honored until retryAfter elapses", async () => {
    const { provider, clock, scheduler } = harness();
    provider.limitsImpl = async () => { throw new RateLimitedError(120); };
    await scheduler.pollLimitsOnce();
    expect(provider.fetchCount).toBe(1);
    await scheduler.pollLimitsOnce(); // still cooling down
    expect(provider.fetchCount).toBe(1);
    clock.now += 121_000;
    provider.limitsImpl = async () => [];
    await scheduler.pollLimitsOnce();
    expect(provider.fetchCount).toBe(2);
  });
  it("unconfigured provider -> unconfigured state, no fetch", async () => {
    const { provider, views, scheduler } = harness();
    provider.configured = false;
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("unconfigured");
    expect(provider.fetchCount).toBe(0);
  });
});

describe("Scheduler.restoreFromCache", () => {
  it("serves cached snapshot as stale", async () => {
    const { bridge, views, scheduler } = harness();
    bridge.cache.set("limits-fake", JSON.stringify({ windows: [{ id: "session", label: "S", usedPercent: 50 }], asOf: 123 }));
    await scheduler.restoreFromCache();
    expect(views.get("fake")!.state).toBe("stale");
    expect(views.get("fake")!.windows![0].usedPercent).toBe(50);
  });
});
