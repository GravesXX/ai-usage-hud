import { describe, expect, it } from "vitest";
import { formatCountdown, localDayKey, startOfTodayMs } from "./time";

describe("formatCountdown", () => {
  it("renders hours+minutes", () => expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe("2h 14m"));
  it("renders minutes only", () => expect(formatCountdown(38 * 60_000)).toBe("38m"));
  it("renders <1m", () => expect(formatCountdown(30_000)).toBe("<1m"));
  it("renders dash for past/absent", () => {
    expect(formatCountdown(-5)).toBe("—");
  });
});

describe("localDayKey", () => {
  it("uses local date parts", () => {
    const d = new Date(2026, 5, 10, 23, 59); // June 10 local
    expect(localDayKey(d)).toBe("2026-06-10");
  });
});

describe("startOfTodayMs", () => {
  it("is midnight local", () => {
    const ms = startOfTodayMs(new Date(2026, 5, 10, 13, 0));
    expect(new Date(ms).getHours()).toBe(0);
    expect(localDayKey(new Date(ms))).toBe("2026-06-10");
  });
});
