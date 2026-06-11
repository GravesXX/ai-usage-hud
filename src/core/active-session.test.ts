import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import { claudeActiveSession, codexActiveSession } from "./active-session";

const NOW = Date.now();

describe("claudeActiveSession", () => {
  it("inactive when process not running", async () => {
    expect(await claudeActiveSession(new FakeBridge(), NOW)).toEqual({ active: false });
  });
  it("active with model from newest recent transcript", async () => {
    const b = new FakeBridge();
    b.runningProcesses = ["claude"];
    b.files.set("/Users/test/.claude/projects/p/s.jsonl", {
      content: `{"type":"assistant","message":{"model":"claude-opus-4-6"}}`,
      mtimeMs: NOW - 60_000,
    });
    expect(await claudeActiveSession(b, NOW)).toEqual({ active: true, model: "claude-opus-4-6" });
  });
  it("active without model when no recent transcript", async () => {
    const b = new FakeBridge();
    b.runningProcesses = ["claude"];
    expect(await claudeActiveSession(b, NOW)).toEqual({ active: true });
  });
});

describe("codexActiveSession", () => {
  it("detects CLI or Codex Desktop", async () => {
    const b = new FakeBridge();
    expect((await codexActiveSession(b)).active).toBe(false);
    b.runningProcesses = ["/Applications/Codex.app/Contents/MacOS/Codex"];
    expect((await codexActiveSession(b)).active).toBe(true);
  });
});
