import type { NativeBridge, FetchInit, FetchResult, FileInfo, ProcQuery } from "./types";

export class FakeBridge implements NativeBridge {
  keychain = new Map<string, string>();
  files = new Map<string, { content: string; mtimeMs: number }>();
  fetchHandler: (url: string, init: FetchInit) => FetchResult = () => ({ status: 500, headers: {}, bodyText: "" });
  runningProcesses: string[] = [];
  cliVersions: Record<string, string | null> = { claude: "2.1.5", codex: "0.40.0" };
  cache = new Map<string, string>();
  home = "/Users/test";

  async readKeychain(service: string): Promise<string> {
    // Mirrors real bridges: stored keychain entries may be the HASHED long form
    // (e.g. "Claude Code-credentials-a1b2c3"); the query is the short prefix.
    // So we match when the stored key k starts with the queried service name.
    for (const [k, v] of this.keychain) if (k === service || k.startsWith(service)) return v;
    throw new Error("keychain-not-found");
  }
  async readTextFile(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`no-file:${path}`);
    return f.content;
  }
  async readFileTail(path: string, maxBytes: number): Promise<string> {
    return (await this.readTextFile(path)).slice(-maxBytes);
  }
  async listFilesRecursive(root: string, suffix: string, modifiedAfterMs = 0): Promise<FileInfo[]> {
    return [...this.files.entries()]
      .filter(([p, f]) => p.startsWith(root) && p.endsWith(suffix) && f.mtimeMs >= modifiedAfterMs)
      .map(([p, f]) => ({ path: p, mtimeMs: f.mtimeMs, sizeBytes: f.content.length }));
  }
  async fetch(url: string, init: FetchInit): Promise<FetchResult> { return this.fetchHandler(url, init); }
  async checkProcesses(queries: ProcQuery[]): Promise<boolean[]> {
    return queries.map((q) => this.runningProcesses.some((p) => (q.exact ? p === q.pattern : p.includes(q.pattern))));
  }
  async getCliVersion(command: "claude" | "codex") { return this.cliVersions[command] ?? null; }
  async readCache(key: string) { return this.cache.get(key) ?? null; }
  async writeCache(key: string, value: string) { this.cache.set(key, value); }
  async homeDir() { return this.home; }
}
