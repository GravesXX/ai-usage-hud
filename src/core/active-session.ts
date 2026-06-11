import type { NativeBridge } from "../bridge/types";
import type { ActiveSession } from "../providers/types";

export async function claudeActiveSession(bridge: NativeBridge, nowMs: number): Promise<ActiveSession> {
  const [running] = await bridge.checkProcesses([{ pattern: "claude", exact: true }]);
  if (!running) return { active: false };
  const home = await bridge.homeDir();
  const files = await bridge.listFilesRecursive(`${home}/.claude/projects`, ".jsonl", nowMs - 5 * 60_000);
  const newest = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!newest) return { active: true };
  try {
    const lines = (await bridge.readFileTail(newest.path, 65_536)).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/"model"\s*:\s*"([^"]+)"/);
      if (m) return { active: true, model: m[1] };
    }
  } catch { /* model is best-effort */ }
  return { active: true };
}

export async function codexActiveSession(bridge: NativeBridge): Promise<ActiveSession> {
  const results = await bridge.checkProcesses([
    { pattern: "codex", exact: true },
    { pattern: "Codex.app", exact: false },
  ]);
  return { active: results.some(Boolean) };
}
