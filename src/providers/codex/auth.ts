import type { NativeBridge } from "../../bridge/types";
import { CredentialError } from "../types";

export interface CodexAuth { accessToken: string; accountId: string }

export async function loadCodexAuth(bridge: NativeBridge): Promise<CodexAuth> {
  const home = await bridge.homeDir();
  let raw: string;
  try { raw = await bridge.readTextFile(`${home}/.codex/auth.json`); }
  catch { throw new CredentialError("not-found"); }
  try {
    const json = JSON.parse(raw);
    const t = json?.tokens;
    if (!t?.access_token || !t?.account_id) throw new Error();
    return { accessToken: String(t.access_token), accountId: String(t.account_id) };
  } catch { throw new CredentialError("malformed"); }
}
