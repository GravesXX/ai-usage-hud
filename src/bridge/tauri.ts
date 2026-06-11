import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  BaseDirectory, SeekMode, exists, mkdir, open, readDir, readTextFile, stat, writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FetchInit, FetchResult, FileInfo, NativeBridge, ProcQuery } from "./types";

export class TauriBridge implements NativeBridge {
  readKeychain(service: string): Promise<string> {
    return invoke<string>("read_keychain", { service });
  }
  readTextFile(path: string): Promise<string> {
    return readTextFile(path);
  }
  async readFileTail(path: string, maxBytes: number): Promise<string> {
    const info = await stat(path);
    const size = info.size;
    const file = await open(path, { read: true });
    try {
      const start = Math.max(0, size - maxBytes);
      await file.seek(start, SeekMode.Start);
      const want = size - start;
      const buf = new Uint8Array(want);
      let filled = 0;
      while (filled < want) {
        const chunk = buf.subarray(filled);
        const n = await file.read(chunk);
        if (n === null || n === 0) break; // EOF
        filled += n;
      }
      return new TextDecoder().decode(buf.subarray(0, filled));
    } finally {
      await file.close();
    }
  }
  async listFilesRecursive(root: string, suffix: string, modifiedAfterMs = 0): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const walk = async (dir: string) => {
      let entries;
      try { entries = await readDir(dir); } catch { return; }
      for (const e of entries) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory) await walk(full);
        else if (e.name.endsWith(suffix)) {
          try {
            const s = await stat(full);
            const mtimeMs = s.mtime ? new Date(s.mtime).getTime() : 0;
            if (mtimeMs >= modifiedAfterMs) results.push({ path: full, mtimeMs, sizeBytes: s.size });
          } catch { /* skip unreadable */ }
        }
      }
    };
    await walk(root);
    return results;
  }
  async fetch(url: string, init: FetchInit): Promise<FetchResult> {
    const resp = await tauriFetch(url, { method: init.method ?? "GET", headers: init.headers });
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: resp.status, headers, bodyText: await resp.text() };
  }
  checkProcesses(queries: ProcQuery[]): Promise<boolean[]> {
    return invoke<boolean[]>("check_processes", { queries });
  }
  getCliVersion(command: "claude" | "codex"): Promise<string | null> {
    return invoke<string | null>("get_cli_version", { command });
  }
  async readCache(key: string): Promise<string | null> {
    const file = `cache-${key}.json`;
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return null;
    return readTextFile(file, { baseDir: BaseDirectory.AppData });
  }
  async writeCache(key: string, value: string): Promise<void> {
    if (!(await exists(".", { baseDir: BaseDirectory.AppData }))) {
      await mkdir(".", { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await writeTextFile(`cache-${key}.json`, value, { baseDir: BaseDirectory.AppData });
  }
  homeDir(): Promise<string> { return homeDir(); }
}
