import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import type { ProviderView } from "./store";
import { publishSnapshot } from "./snapshot";

const view = (id: string): ProviderView => ({
  id, displayName: id, state: "ok", windows: [{ id: "session", label: "S", usedPercent: 5 }],
  asOf: 1, today: { tokens: 10 }, active: { active: false },
});

describe("publishSnapshot", () => {
  it("writes the serialized snapshot through the bridge", async () => {
    const b = new FakeBridge();
    await publishSnapshot(b, [view("claude-code"), view("codex")], 123);
    expect(b.groupSnapshot).not.toBeNull();
    const parsed = JSON.parse(b.groupSnapshot!);
    expect(parsed.version).toBe(1);
    expect(parsed.updatedAt).toBe(123);
    expect(parsed.providers.map((p: { id: string }) => p.id)).toEqual(["claude-code", "codex"]);
  });
});
