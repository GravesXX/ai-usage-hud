import { describe, expect, it } from "vitest";
import { formatTokens } from "./format";

describe("formatTokens", () => {
  it("millions", () => expect(formatTokens(1_234_567)).toBe("1.2M"));
  it("thousands", () => expect(formatTokens(45_600)).toBe("45.6k"));
  it("small", () => expect(formatTokens(999)).toBe("999"));
});
