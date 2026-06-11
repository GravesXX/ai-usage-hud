import { describe, expect, it } from "vitest";
import { barColor } from "./colors";

describe("barColor", () => {
  it("neutral below 70", () => expect(barColor(69.9)).toBe("var(--accent)"));
  it("amber at 70+", () => expect(barColor(70)).toBe("var(--amber)"));
  it("red at 90+", () => expect(barColor(90)).toBe("var(--red)"));
});
