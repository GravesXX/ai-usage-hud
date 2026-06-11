import { describe, expect, it } from "vitest";
import claudeFixture from "../../fixtures/claude-usage.json";
import whamFixture from "../../fixtures/codex-wham-usage.json";
import { FakeBridge } from "../bridge/fake";
import { createProviders } from "./registry";
import { CredentialError } from "./types";

const FUTURE = 4102444800000; // 2100
const CLAUDE_CREDS = JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt: FUTURE, subscriptionType: "max" } });
const CODEX_AUTH = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "at", account_id: "acct" } });

function bridgeWithBoth() {
  const b = new FakeBridge();
  b.keychain.set("Claude Code-credentials", CLAUDE_CREDS);
  b.files.set("/Users/test/.codex/auth.json", { content: CODEX_AUTH, mtimeMs: 1 });
  b.fetchHandler = (url) => ({
    status: 200, headers: {},
    bodyText: JSON.stringify(url.includes("anthropic") ? claudeFixture : whamFixture),
  });
  return b;
}

describe("createProviders", () => {
  it("registers claude-code and codex", () => {
    const ids = createProviders(new FakeBridge()).map((p) => p.id);
    expect(ids).toEqual(["claude-code", "codex"]);
  });
  it("end-to-end: both providers fetch limits and set captions", async () => {
    const [claude, codex] = createProviders(bridgeWithBoth());
    expect((await claude.fetchLimits()).length).toBe(2);
    expect(claude.caption).toBe("max");
    expect((await codex.fetchLimits()).length).toBe(2);
    expect(codex.caption).toBe("plus");
  });
  it("claude throws expired for past expiresAt", async () => {
    const b = bridgeWithBoth();
    b.keychain.set("Claude Code-credentials",
      JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt: 1000 } }));
    const [claude] = createProviders(b);
    await expect(claude.fetchLimits()).rejects.toThrow(CredentialError);
  });
  it("codex falls back to JSONL when endpoint fails", async () => {
    const b = bridgeWithBoth();
    b.fetchHandler = (url) =>
      url.includes("chatgpt") ? { status: 500, headers: {}, bodyText: "" }
        : { status: 200, headers: {}, bodyText: JSON.stringify(claudeFixture) };
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const dir = `/Users/test/.codex/sessions/${today.getFullYear()}/${p(today.getMonth() + 1)}/${p(today.getDate())}`;
    b.files.set(`${dir}/rollout-x.jsonl`, {
      content: JSON.stringify({ payload: { type: "token_count", rate_limits: { primary: { used_percent: 9, window_minutes: 300, resets_at: 1781000000 }, secondary: null } } }),
      mtimeMs: Date.now(),
    });
    const [, codex] = createProviders(b);
    const w = await codex.fetchLimits();
    expect(w[0]).toMatchObject({ id: "session", usedPercent: 9 });
  });
  it("isConfigured false on empty machine", async () => {
    for (const p of createProviders(new FakeBridge())) expect(await p.isConfigured()).toBe(false);
  });
});
