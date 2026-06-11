import type { NativeBridge } from "../../bridge/types";
import { CredentialError } from "../types";

export interface ClaudeCredentials {
  accessToken: string;
  expiresAt: number; // epoch ms; 0 = unknown (recovered from truncated payload)
  subscriptionType?: string;
}

export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export function parseClaudeCredentialJson(raw: string): ClaudeCredentials {
  try {
    const json = JSON.parse(raw);
    const o = json?.claudeAiOauth;
    if (o?.accessToken) {
      return {
        accessToken: String(o.accessToken),
        expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : 0,
        subscriptionType: o.subscriptionType ? String(o.subscriptionType) : undefined,
      };
    }
  } catch {
    // truncated keychain payload (security CLI truncates >2KB) — regex last resort
    const m = raw.match(/"accessToken"\s*:\s*"([^"]+)"/);
    if (m) return { accessToken: m[1], expiresAt: 0 };
  }
  throw new CredentialError("malformed");
}

export async function loadClaudeCredentials(bridge: NativeBridge): Promise<ClaudeCredentials> {
  try {
    return parseClaudeCredentialJson(await bridge.readKeychain(CLAUDE_KEYCHAIN_SERVICE));
  } catch (e) {
    if (e instanceof CredentialError && e.reason === "malformed") throw e;
  }
  try {
    const home = await bridge.homeDir();
    return parseClaudeCredentialJson(await bridge.readTextFile(`${home}/.claude/.credentials.json`));
  } catch (e) {
    if (e instanceof CredentialError && e.reason === "malformed") throw e;
    throw new CredentialError("not-found");
  }
}
