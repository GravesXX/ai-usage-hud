import { describe, expect, it } from "vitest";
import { hudStore } from "./store";

describe("hudStore.upsert", () => {
  it("creates a default view then merges patches", () => {
    hudStore.getState().upsert("x", { displayName: "X", state: "ok" });
    hudStore.getState().upsert("x", { today: { tokens: 9 } });
    const v = hudStore.getState().providers["x"];
    expect(v.displayName).toBe("X");
    expect(v.state).toBe("ok");
    expect(v.today).toEqual({ tokens: 9 });
    expect(v.active).toEqual({ active: false });
  });
});
