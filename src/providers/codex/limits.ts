import type { NativeBridge } from "../../bridge/types";
import { clampPercent, HttpError, type LimitWindow, RateLimitedError } from "../types";
import type { CodexAuth } from "./auth";
import { sessionsDirFor } from "./today-stats";

/** Union of the three observed shapes: REST wham/usage, session-JSONL snapshot, websocket event. */
export interface CodexRawWindow {
  used_percent?: number;
  window_minutes?: number | null;       // JSONL + websocket
  limit_window_seconds?: number | null; // REST
  resets_at?: number | null;            // JSONL (epoch sec)
  reset_at?: number | null;             // REST + websocket (epoch sec)
  resets_in_seconds?: number | null;    // legacy JSONL (relative)
  reset_after_seconds?: number | null;  // websocket (relative)
}

function windowMinutes(w: CodexRawWindow): number | null {
  if (typeof w.window_minutes === "number") return w.window_minutes;
  if (typeof w.limit_window_seconds === "number") return w.limit_window_seconds / 60;
  return null;
}

function resetsAtIso(w: CodexRawWindow, capturedAtMs: number): string | undefined {
  const abs = w.reset_at ?? w.resets_at;
  if (typeof abs === "number") return new Date(abs * 1000).toISOString();
  const rel = w.reset_after_seconds ?? w.resets_in_seconds;
  if (typeof rel === "number") return new Date(capturedAtMs + rel * 1000).toISOString();
  return undefined;
}

function classify(w: CodexRawWindow, positionFallback: "session" | "weekly"): { id: string; label: string } {
  const mins = windowMinutes(w);
  const kind = mins === null ? positionFallback : mins <= 300 ? "session" : "weekly";
  return kind === "session" ? { id: "session", label: "5-hour" } : { id: "weekly", label: "Weekly" };
}

export function normalizeCodexWindows(
  raw: { primary?: CodexRawWindow | null; secondary?: CodexRawWindow | null },
  capturedAtMs: number,
): LimitWindow[] {
  const out: LimitWindow[] = [];
  const pairs: Array<[CodexRawWindow | null | undefined, "session" | "weekly"]> = [
    [raw.primary, "session"],
    [raw.secondary, "weekly"],
  ];
  for (const [w, fallback] of pairs) {
    if (!w) continue;
    const { id, label } = classify(w, fallback);
    out.push({ id, label, usedPercent: clampPercent(w.used_percent ?? 0), resetsAt: resetsAtIso(w, capturedAtMs) });
  }
  return out;
}

export interface CodexLimitsResult { windows: LimitWindow[]; planType?: string }

export async function fetchCodexLimits(
  bridge: NativeBridge,
  auth: CodexAuth,
  nowMs: number,
): Promise<CodexLimitsResult> {
  const resp = await bridge.fetch("https://chatgpt.com/backend-api/wham/usage", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "ChatGPT-Account-Id": auth.accountId,
      Accept: "application/json",
    },
  });
  if (resp.status === 429) {
    const ra = Number.parseInt(resp.headers["retry-after"] ?? "", 10);
    throw new RateLimitedError(Number.isFinite(ra) ? ra : null);
  }
  if (resp.status !== 200) throw new HttpError(resp.status);
  const json = JSON.parse(resp.bodyText);
  const windows = normalizeCodexWindows(
    { primary: json?.rate_limit?.primary_window, secondary: json?.rate_limit?.secondary_window },
    nowMs,
  );
  return { windows, planType: json?.plan_type ? String(json.plan_type) : undefined };
}

/** Newest non-null rate_limits from session JSONLs (today, then yesterday). Null if none. */
export async function codexJsonlFallback(bridge: NativeBridge, nowMs: number): Promise<LimitWindow[] | null> {
  const home = await bridge.homeDir();
  const dirs = [new Date(nowMs), new Date(nowMs - 86_400_000)].map((d) => sessionsDirFor(home, d));
  const fileLists = await Promise.all(dirs.map((d) => bridge.listFilesRecursive(d, ".jsonl")));
  const files = fileLists.flat().sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files) {
    let tail: string;
    try { tail = await bridge.readFileTail(f.path, 262_144); } catch { continue; }
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const rl = JSON.parse(lines[i])?.payload?.rate_limits;
        if (rl?.primary || rl?.secondary) {
          return normalizeCodexWindows({ primary: rl.primary, secondary: rl.secondary }, f.mtimeMs);
        }
      } catch { continue; }
    }
  }
  return null;
}
