import type { NativeBridge } from "../../bridge/types";
import { clampPercent, HttpError, type LimitWindow, RateLimitedError } from "../types";
import type { ClaudeCredentials } from "./credentials";

const WINDOW_MAP: Array<{ key: string; id: string; label: string; skipIfZero: boolean }> = [
  { key: "five_hour", id: "session", label: "Session", skipIfZero: false },
  { key: "seven_day", id: "weekly", label: "Weekly", skipIfZero: false },
  { key: "seven_day_opus", id: "weekly-opus", label: "Weekly (Opus)", skipIfZero: true },
];

function parseUtilization(v: unknown): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return clampPercent(n);
}

function parseIso(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const d = new Date(v); // handles with/without fractional seconds
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseClaudeUsage(json: unknown): LimitWindow[] {
  const obj = (json ?? {}) as Record<string, { utilization?: unknown; resets_at?: unknown } | undefined>;
  const windows: LimitWindow[] = [];
  for (const { key, id, label, skipIfZero } of WINDOW_MAP) {
    const w = obj[key];
    if (!w) continue;
    const usedPercent = parseUtilization(w.utilization);
    if (skipIfZero && usedPercent === 0) continue;
    windows.push({ id, label, usedPercent, resetsAt: parseIso(w.resets_at) });
  }
  return windows;
}

export async function fetchClaudeLimits(
  bridge: NativeBridge,
  creds: Pick<ClaudeCredentials, "accessToken">,
  cliVersion: string,
): Promise<LimitWindow[]> {
  const resp = await bridge.fetch("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `claude-code/${cliVersion}`,
    },
  });
  if (resp.status === 429) {
    const ra = Number.parseInt(resp.headers["retry-after"] ?? "", 10);
    throw new RateLimitedError(Number.isFinite(ra) ? ra : null);
  }
  if (resp.status !== 200) throw new HttpError(resp.status);
  return parseClaudeUsage(JSON.parse(resp.bodyText));
}
