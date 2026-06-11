import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FetchInit, FetchResult, FileInfo, NativeBridge, ProcQuery } from "./types";

const run = promisify(execFile);

export class NodeBridge implements NativeBridge {
  private cacheDir = path.join(os.homedir(), ".cache", "ai-usage-hud-probe");

  async readKeychain(service: string): Promise<string> {
    const user = os.userInfo().username;
    const tryRead = async (svc: string) => {
      const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", svc, "-a", user, "-w"]);
      return stdout.trim();
    };
    try { return await tryRead(service); } catch { /* fall through to prefix scan */ }
    try {
      const { stdout } = await run("/usr/bin/security", ["dump-keychain"], { maxBuffer: 64 * 1024 * 1024 });
      for (const line of stdout.split("\n")) {
        if (!line.includes('"svce"')) continue;
        const name = line.split('"')[3];
        if (name && name.startsWith(service) && name !== service) {
          try { return await tryRead(name); } catch { /* keep scanning */ }
        }
      }
    } catch { /* dump failed */ }
    throw new Error("keychain-not-found");
  }
  readTextFile(p: string): Promise<string> { return fs.readFile(p, "utf8"); }
  async readFileTail(p: string, maxBytes: number): Promise<string> {
    const fh = await fs.open(p, "r");
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally { await fh.close(); }
  }
  async listFilesRecursive(root: string, suffix: string, modifiedAfterMs = 0): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const walk = async (dir: string) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.name.endsWith(suffix)) {
          try {
            const s = await fs.stat(full);
            if (s.mtimeMs >= modifiedAfterMs) results.push({ path: full, mtimeMs: s.mtimeMs, sizeBytes: s.size });
          } catch { /* skip */ }
        }
      }
    };
    await walk(root);
    return results;
  }
  async fetch(url: string, init: FetchInit): Promise<FetchResult> {
    const resp = await fetch(url, { method: init.method ?? "GET", headers: init.headers });
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: resp.status, headers, bodyText: await resp.text() };
  }
  async checkProcesses(queries: ProcQuery[]): Promise<boolean[]> {
    const results: boolean[] = [];
    for (const q of queries) {
      try { await run("/usr/bin/pgrep", [q.exact ? "-x" : "-f", q.pattern]); results.push(true); }
      catch { results.push(false); }
    }
    return results;
  }
  async getCliVersion(command: "claude" | "codex"): Promise<string | null> {
    try {
      const { stdout } = await run(command, ["--version"]);
      const tok = stdout.split(/\s+/).find((t) => /^\d+\.\d+/.test(t));
      return tok ?? null;
    } catch { return null; }
  }
  async readCache(key: string): Promise<string | null> {
    try { return await fs.readFile(path.join(this.cacheDir, `cache-${key}.json`), "utf8"); }
    catch { return null; }
  }
  async writeCache(key: string, value: string): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(path.join(this.cacheDir, `cache-${key}.json`), value, "utf8");
  }
  async homeDir(): Promise<string> { return os.homedir(); }
}
