import { describe, expect, it } from "vitest";
import { FakeBridge } from "../../bridge/fake";
import { CredentialError } from "../types";
import { loadClaudeCredentials, parseClaudeCredentialJson } from "./credentials";

const GOOD = JSON.stringify({
  claudeAiOauth: {
    accessToken: "sk-ant-oat01-AAA",
    refreshToken: "sk-ant-ort01-BBB",
    expiresAt: 1781000000000,
    scopes: ["user:profile"],
    subscriptionType: "max",
  },
});

describe("parseClaudeCredentialJson", () => {
  it("parses well-formed credentials", () => {
    const c = parseClaudeCredentialJson(GOOD);
    expect(c.accessToken).toBe("sk-ant-oat01-AAA");
    expect(c.expiresAt).toBe(1781000000000);
    expect(c.subscriptionType).toBe("max");
  });
  it("recovers accessToken from truncated keychain payloads (>2KB security CLI bug)", () => {
    const truncated = GOOD.slice(0, GOOD.indexOf("refreshToken") + 5); // cut mid-JSON
    const c = parseClaudeCredentialJson(truncated);
    expect(c.accessToken).toBe("sk-ant-oat01-AAA");
    expect(c.expiresAt).toBe(0); // unknown -> treated as unexpired by caller policy below
  });
  it("throws malformed when no token recoverable", () => {
    expect(() => parseClaudeCredentialJson("garbage")).toThrow(CredentialError);
  });
});

describe("loadClaudeCredentials", () => {
  it("prefers keychain (incl. hashed service names)", async () => {
    const b = new FakeBridge();
    b.keychain.set("Claude Code-credentials-a1b2c3", GOOD);
    const c = await loadClaudeCredentials(b);
    expect(c.accessToken).toBe("sk-ant-oat01-AAA");
  });
  it("falls back to ~/.claude/.credentials.json", async () => {
    const b = new FakeBridge();
    b.files.set("/Users/test/.claude/.credentials.json", { content: GOOD, mtimeMs: 1 });
    const c = await loadClaudeCredentials(b);
    expect(c.accessToken).toBe("sk-ant-oat01-AAA");
  });
  it("throws not-found when neither exists", async () => {
    await expect(loadClaudeCredentials(new FakeBridge())).rejects.toThrow("credential-not-found");
  });
});
