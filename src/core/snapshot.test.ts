import { describe, expect, it } from "vitest";
import type { ProviderView } from "./store";
import { buildSnapshot } from "./snapshot";

const baseView = (over: Partial<ProviderView>): ProviderView => ({
  id: "claude-code", displayName: "Claude Code", state: "ok",
  windows: [], asOf: 1, today: null, active: { active: false }, ...over,
});

describe("buildSnapshot", () => {
  it("projects views to the versioned contract, dropping runtime-only fields but keeping note", () => {
    const views: ProviderView[] = [
      baseView({
        caption: "max",
        windows: [
          { id: "session", label: "Session", usedPercent: 62, resetsAt: "2026-06-11T01:14:00.000Z" },
          { id: "weekly", label: "Weekly", usedPercent: 28 },
        ],
        today: { tokens: 2502413, costUSD: 6.54, byModel: { "claude-opus-4-8": 2502413 } },
        active: { active: true, model: "x" }, note: "rate limited — retrying", asOf: 99,
      }),
    ];
    const snap = buildSnapshot(views, 1781186540979);
    expect(snap.version).toBe(1);
    expect(snap.updatedAt).toBe(1781186540979);
    expect(snap.providers).toEqual([
      {
        id: "claude-code", displayName: "Claude Code", state: "ok", caption: "max",
        windows: [
          { label: "Session", usedPercent: 62, resetsAt: "2026-06-11T01:14:00.000Z" },
          { label: "Weekly", usedPercent: 28, resetsAt: undefined },
        ],
        today: { tokens: 2502413, costUSD: 6.54 },
        note: "rate limited — retrying",
      },
    ]);
  });
  it("omits today/caption/note when the view has none", () => {
    const snap = buildSnapshot([baseView({ today: null })], 5);
    expect(snap.providers[0].today).toBeUndefined();
    expect(snap.providers[0].caption).toBeUndefined();
    expect(snap.providers[0].note).toBeUndefined();
  });
  it("preserves non-ok states for the widget to dim", () => {
    const snap = buildSnapshot([baseView({ state: "unconfigured" })], 5);
    expect(snap.providers[0].state).toBe("unconfigured");
  });
});
