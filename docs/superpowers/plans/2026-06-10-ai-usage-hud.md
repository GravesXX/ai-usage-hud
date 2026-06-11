# AI Usage HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 macOS desktop widget pinned to the wallpaper layer showing Claude Code & Codex rate limits, today's token/cost stats, and active-session indicators.

**Architecture:** TS-heavy Tauri 2 app. All provider/scheduler/UI logic is TypeScript in the webview behind a `NativeBridge` interface with three implementations (Tauri, Node for the probe CLI, Fake for tests). Rust is a thin shim: 4 tiny commands (keychain, pgrep, CLI version, window mode), ~40 lines of objc2 desktop-pinning glue, and the tray. HTTP/FS go through official Tauri plugins with declarative scope allowlists (same security posture as the spec's custom commands, less code — refinement noted vs spec).

**Tech Stack:** Tauri 2, React 18 + Vite + TypeScript, zustand, Vitest, tsx (probe), objc2, tauri-plugin-http/fs/autostart.

**Spec:** `docs/superpowers/specs/2026-06-10-ai-usage-hud-design.md` — read it first.

---

## File map

```
ai-usage-hud/
├── src/
│   ├── bridge/types.ts          # NativeBridge + FetchResult/FileInfo/ProcQuery
│   ├── bridge/tauri.ts          # TauriBridge (plugins + invoke)
│   ├── bridge/node.ts           # NodeBridge (fs/child_process/fetch) — probe only
│   ├── bridge/fake.ts           # FakeBridge for tests
│   ├── providers/types.ts       # UsageProvider, LimitWindow, TodayStats, errors
│   ├── providers/claude-code/credentials.ts
│   ├── providers/claude-code/limits.ts
│   ├── providers/claude-code/today-stats.ts
│   ├── providers/claude-code/pricing.ts
│   ├── providers/claude-code/index.ts   # ClaudeCodeProvider
│   ├── providers/codex/auth.ts
│   ├── providers/codex/limits.ts        # wham fetch + 3-shape normalizer
│   ├── providers/codex/today-stats.ts
│   ├── providers/codex/index.ts         # CodexProvider
│   ├── providers/registry.ts
│   ├── core/active-session.ts
│   ├── core/scheduler.ts
│   ├── core/store.ts
│   ├── core/time.ts             # localDayKey, formatCountdown
│   ├── ui/App.tsx, ProviderCard.tsx, LimitBar.tsx, theme.css
│   ├── main.tsx
│   └── probe.ts
├── src-tauri/src/{lib.rs, commands.rs, desktop_pin.rs, tray.rs}
├── src-tauri/capabilities/default.json
└── fixtures/*.json, *.jsonl
```

Tests are colocated: `foo.ts` → `foo.test.ts`.

---

### Task 1: Scaffold & configuration

**Files:** entire scaffold; Modify: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `package.json`

- [ ] **Step 1: Scaffold into the existing repo** (repo already has `docs/` + git)

```bash
cd ~/Desktop/ai-usage-hud
npm create tauri-app@latest hud-tmp -- --template react-ts --manager npm --yes --identifier com.moomoo.ai-usage-hud
cp -R hud-tmp/. . && rm -rf hud-tmp
npm install
```

- [ ] **Step 2: Add plugins and dev deps**

```bash
npm run tauri add http
npm run tauri add fs
npm run tauri add autostart
npm i zustand
npm i -D vitest tsx @types/node
```

(`tauri add` registers each plugin in `src-tauri/src/lib.rs` and `Cargo.toml` automatically. For autostart, if `lib.rs` registration needs the launcher arg, use: `.plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))`.)

- [ ] **Step 3: Enable forbidden headers for the HTTP plugin** (we must send `User-Agent`)

In `src-tauri/Cargo.toml`, change the http plugin line to:

```toml
tauri-plugin-http = { version = "2", features = ["unsafe-headers"] }
```

- [ ] **Step 4: Window + app config.** In `src-tauri/tauri.conf.json` replace the `app` section's windows and add `macOSPrivateApi` (required for transparent windows on macOS):

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [
    {
      "label": "main",
      "title": "AI Usage HUD",
      "width": 300,
      "height": 380,
      "decorations": false,
      "transparent": true,
      "shadow": false,
      "resizable": false,
      "skipTaskbar": true,
      "focus": false,
      "alwaysOnTop": false,
      "visibleOnAllWorkspaces": true
    }
  ],
  "security": { "csp": null }
}
```

- [ ] **Step 5: Capabilities.** Replace `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://api.anthropic.com/*" },
        { "url": "https://chatgpt.com/*" }
      ]
    },
    "fs:allow-read-text-file",
    "fs:allow-read-dir",
    "fs:allow-stat",
    "fs:allow-exists",
    "fs:allow-open",
    "fs:allow-read",
    "fs:allow-seek",
    "fs:allow-write-text-file",
    "fs:allow-mkdir",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$HOME/.claude" }, { "path": "$HOME/.claude/**" },
        { "path": "$HOME/.codex" },  { "path": "$HOME/.codex/**" },
        { "path": "$APPDATA" },      { "path": "$APPDATA/**" }
      ]
    }
  ]
}
```

- [ ] **Step 6: Vitest config.** Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
```

Add to `package.json` scripts: `"test": "vitest run", "probe": "tsx src/probe.ts"`.
In `tsconfig.json` compilerOptions ensure: `"resolveJsonModule": true`.

- [ ] **Step 7: Verify**

Run: `npm run tauri dev` → a small empty transparent window appears (normal level for now; pinning comes in Task 14). Ctrl-C.
Run: `npx vitest run` → exits 0 ("no test files found" is expected at this stage; `passWithNoTests` covers it).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Tauri 2 + React TS app with scoped capabilities"
```

---

### Task 2: Core types + FakeBridge

**Files:** Create: `src/providers/types.ts`, `src/bridge/types.ts`, `src/bridge/fake.ts`, `src/core/time.ts`, `src/core/time.test.ts`

- [ ] **Step 1: Bridge types.** Create `src/bridge/types.ts`:

```ts
export interface FileInfo { path: string; mtimeMs: number; sizeBytes: number }
export interface ProcQuery { pattern: string; exact: boolean }
export interface FetchInit { method?: string; headers?: Record<string, string> }
export interface FetchResult { status: number; headers: Record<string, string>; bodyText: string }

export interface NativeBridge {
  /** Exact service name, then prefix-scan fallback (Claude Code v2.1.52+ hashed names). Throws Error("keychain-not-found") */
  readKeychain(service: string): Promise<string>;
  readTextFile(path: string): Promise<string>;
  /** Last maxBytes of a file (for cheap model detection on huge transcripts) */
  readFileTail(path: string, maxBytes: number): Promise<string>;
  listFilesRecursive(root: string, suffix: string, modifiedAfterMs?: number): Promise<FileInfo[]>;
  fetch(url: string, init: FetchInit): Promise<FetchResult>;
  checkProcesses(queries: ProcQuery[]): Promise<boolean[]>;
  getCliVersion(command: "claude" | "codex"): Promise<string | null>;
  readCache(key: string): Promise<string | null>;
  writeCache(key: string, value: string): Promise<void>;
  homeDir(): Promise<string>;
}
```

- [ ] **Step 2: Provider types.** Create `src/providers/types.ts`:

```ts
export interface LimitWindow {
  id: string;            // 'session' | 'weekly' | 'weekly-opus' | ...
  label: string;
  usedPercent: number;   // 0-100 clamped
  resetsAt?: string;     // ISO
}
export interface TodayStats { tokens: number; costUSD?: number; byModel?: Record<string, number> }
export interface ActiveSession { active: boolean; model?: string }
export type ProviderState = "ok" | "stale" | "unconfigured" | "error";

export interface UsageProvider {
  id: string;
  displayName: string;
  /** Small caption shown next to the name, e.g. plan type "max"/"plus". Set by fetchLimits. */
  caption?: string;
  isConfigured(): Promise<boolean>;
  fetchLimits(): Promise<LimitWindow[]>;
  fetchTodayStats(): Promise<TodayStats>;
  checkActiveSession(): Promise<ActiveSession>;
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSec: number | null) { super("rate-limited"); }
}
export class HttpError extends Error {
  constructor(public status: number) { super(`http-${status}`); }
}
export class CredentialError extends Error {
  constructor(public reason: "not-found" | "expired" | "malformed") { super(`credential-${reason}`); }
}

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
```

- [ ] **Step 3: FakeBridge.** Create `src/bridge/fake.ts`:

```ts
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
```

- [ ] **Step 4: Time helpers, TDD.** Create `src/core/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCountdown, localDayKey, startOfTodayMs } from "./time";

describe("formatCountdown", () => {
  it("renders hours+minutes", () => expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe("2h 14m"));
  it("renders minutes only", () => expect(formatCountdown(38 * 60_000)).toBe("38m"));
  it("renders <1m", () => expect(formatCountdown(30_000)).toBe("<1m"));
  it("renders dash for past/absent", () => {
    expect(formatCountdown(-5)).toBe("—");
  });
});

describe("localDayKey", () => {
  it("uses local date parts", () => {
    const d = new Date(2026, 5, 10, 23, 59); // June 10 local
    expect(localDayKey(d)).toBe("2026-06-10");
  });
});

describe("startOfTodayMs", () => {
  it("is midnight local", () => {
    const ms = startOfTodayMs(new Date(2026, 5, 10, 13, 0));
    expect(new Date(ms).getHours()).toBe(0);
    expect(localDayKey(new Date(ms))).toBe("2026-06-10");
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/core/time.test.ts` → FAIL (module not found).

- [ ] **Step 6: Implement.** Create `src/core/time.ts`:

```ts
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "—";
  const mins = Math.floor(msRemaining / 60_000);
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfTodayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
```

- [ ] **Step 7: Run tests** — `npx vitest run` → PASS.

- [ ] **Step 8: Commit** — `git add src && git commit -m "feat: core types, FakeBridge, time helpers"`

---

### Task 3: Rust commands + Tauri/Node bridges

**Files:** Create: `src-tauri/src/commands.rs`, `src/bridge/tauri.ts`, `src/bridge/node.ts`; Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Rust commands.** Create `src-tauri/src/commands.rs`:

```rust
use std::process::Command;

fn run_security(service: &str, account: &str) -> Result<String, String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("keychain-not-found".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn current_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| {
        Command::new("/usr/bin/id")
            .arg("-un")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    })
}

/// Exact service, then prefix-scan via `security dump-keychain` (names only, no secrets)
/// to find hashed variants like "Claude Code-credentials-<HASH>" (Claude Code v2.1.52+).
#[tauri::command]
pub fn read_keychain(service: String) -> Result<String, String> {
    let account = current_user();
    if let Ok(v) = run_security(&service, &account) {
        return Ok(v);
    }
    let dump = Command::new("/usr/bin/security")
        .arg("dump-keychain")
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&dump.stdout);
    for line in text.lines() {
        if line.contains("\"svce\"") {
            if let Some(name) = line.split('"').nth(3) {
                if name.starts_with(&service) && name != service {
                    if let Ok(v) = run_security(name, &account) {
                        return Ok(v);
                    }
                }
            }
        }
    }
    Err("keychain-not-found".into())
}

#[derive(serde::Deserialize)]
pub struct ProcQuery { pub pattern: String, pub exact: bool }

#[tauri::command]
pub fn check_processes(queries: Vec<ProcQuery>) -> Vec<bool> {
    queries.iter().map(|q| {
        let flag = if q.exact { "-x" } else { "-f" };
        Command::new("/usr/bin/pgrep")
            .args([flag, &q.pattern])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }).collect()
}

/// GUI apps don't inherit shell PATH, so probe common install locations.
#[tauri::command]
pub fn get_cli_version(command: String) -> Option<String> {
    if command != "claude" && command != "codex" { return None; }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        command.clone(),
        format!("{home}/.local/bin/{command}"),
        format!("/opt/homebrew/bin/{command}"),
        format!("/usr/local/bin/{command}"),
        format!("{home}/.npm-global/bin/{command}"),
    ];
    for c in candidates {
        if let Ok(out) = Command::new(&c).arg("--version").output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(v) = text.split_whitespace().find(|t| {
                    t.split('.').count() >= 2 && t.chars().next().is_some_and(|ch| ch.is_ascii_digit())
                }) {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}
```

- [ ] **Step 2: Register commands.** In `src-tauri/src/lib.rs` add `mod commands;` at the top, and inside the builder chain (the scaffold has `tauri::Builder::default()`), add:

```rust
.invoke_handler(tauri::generate_handler![
    commands::read_keychain,
    commands::check_processes,
    commands::get_cli_version
])
```

(If the scaffold's `greet` command exists, delete it and its handler/frontend usage.)

- [ ] **Step 3: Build check** — Run: `cd src-tauri && cargo check && cd ..` → compiles clean.

- [ ] **Step 4: TauriBridge.** Create `src/bridge/tauri.ts`:

```ts
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
      const buf = new Uint8Array(size - start);
      await file.read(buf);
      return new TextDecoder().decode(buf);
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
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await writeTextFile(`cache-${key}.json`, value, { baseDir: BaseDirectory.AppData });
  }
  homeDir(): Promise<string> { return homeDir(); }
}
```

- [ ] **Step 5: NodeBridge.** Create `src/bridge/node.ts` (imported ONLY by `probe.ts` — never from UI code):

```ts
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
```

- [ ] **Step 6: Typecheck + tests** — Run: `npx tsc --noEmit && npx vitest run` → clean. (No new unit tests: both bridges are thin OS adapters, exercised by `npm run probe` in Task 12 and by the app itself.)

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: Rust shim commands and Tauri/Node bridges"`

---

### Task 4: Claude credentials

**Files:** Create: `src/providers/claude-code/credentials.ts`, `credentials.test.ts`

- [ ] **Step 1: Failing tests.** Create `src/providers/claude-code/credentials.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/providers/claude-code` → FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/providers/claude-code/credentials.ts`:

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `git add src && git commit -m "feat: Claude credential loading with keychain fallback chain"`

---

### Task 5: Claude limits fetch + normalize

**Files:** Create: `src/providers/claude-code/limits.ts`, `limits.test.ts`, `fixtures/claude-usage.json`

- [ ] **Step 1: Fixture.** Create `fixtures/claude-usage.json`:

```json
{
  "five_hour": { "utilization": 62, "resets_at": "2026-06-10T18:00:00.000Z" },
  "seven_day": { "utilization": "28.4", "resets_at": "2026-06-14T07:00:00Z" },
  "seven_day_opus": { "utilization": 0, "resets_at": null },
  "extra_usage": { "is_enabled": false, "monthly_limit": 0, "used_credits": 0 }
}
```

- [ ] **Step 2: Failing tests.** Create `src/providers/claude-code/limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/claude-usage.json";
import { FakeBridge } from "../../bridge/fake";
import { HttpError, RateLimitedError } from "../types";
import { fetchClaudeLimits, parseClaudeUsage } from "./limits";

describe("parseClaudeUsage", () => {
  it("maps windows, parses string utilization, skips zero opus window", () => {
    const windows = parseClaudeUsage(fixture);
    expect(windows).toEqual([
      { id: "session", label: "Session", usedPercent: 62, resetsAt: "2026-06-10T18:00:00.000Z" },
      { id: "weekly", label: "Weekly", usedPercent: 28.4, resetsAt: "2026-06-14T07:00:00.000Z" },
    ]);
  });
  it("includes opus window when non-zero", () => {
    const w = parseClaudeUsage({ seven_day_opus: { utilization: 12, resets_at: "2026-06-14T07:00:00Z" } });
    expect(w).toEqual([
      { id: "weekly-opus", label: "Weekly (Opus)", usedPercent: 12, resetsAt: "2026-06-14T07:00:00.000Z" },
    ]);
  });
  it("clamps and tolerates junk", () => {
    const w = parseClaudeUsage({ five_hour: { utilization: 250, resets_at: "not-a-date" } });
    expect(w).toEqual([{ id: "session", label: "Session", usedPercent: 100, resetsAt: undefined }]);
  });
});

describe("fetchClaudeLimits", () => {
  const creds = { accessToken: "tok", expiresAt: 0 };
  it("sends required headers", async () => {
    const b = new FakeBridge();
    let seen: Record<string, string> = {};
    b.fetchHandler = (url, init) => {
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
      seen = init.headers ?? {};
      return { status: 200, headers: {}, bodyText: JSON.stringify(fixture) };
    };
    await fetchClaudeLimits(b, creds, "2.1.5");
    expect(seen["Authorization"]).toBe("Bearer tok");
    expect(seen["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(seen["User-Agent"]).toBe("claude-code/2.1.5");
  });
  it("throws RateLimitedError with Retry-After on 429", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 429, headers: { "retry-after": "120" }, bodyText: "" });
    await expect(fetchClaudeLimits(b, creds, "2.1.5")).rejects.toThrow(RateLimitedError);
    await fetchClaudeLimits(b, creds, "2.1.5").catch((e) => expect(e.retryAfterSec).toBe(120));
  });
  it("throws HttpError otherwise", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 403, headers: {}, bodyText: "" });
    await expect(fetchClaudeLimits(b, creds, "2.1.5")).rejects.toThrow(HttpError);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/providers/claude-code/limits.test.ts` → FAIL.

- [ ] **Step 4: Implement.** Create `src/providers/claude-code/limits.ts`:

```ts
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
```

- [ ] **Step 5: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Claude usage endpoint fetcher and normalizer"`

---

### Task 6: Claude today stats (local JSONL)

**Files:** Create: `src/providers/claude-code/pricing.ts`, `src/providers/claude-code/today-stats.ts`, `today-stats.test.ts`

- [ ] **Step 1: Pricing table.** Create `src/providers/claude-code/pricing.ts` (approximate, USD per million tokens; edit freely as models change — UI always renders cost with "≈"):

```ts
export interface ModelPrice { in: number; out: number; cacheRead: number; cacheWrite: number }

// Ordered: first substring match wins.
const PRICES: Array<[match: string, price: ModelPrice]> = [
  ["opus-4-5", { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["opus-4-6", { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["opus-4", { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["sonnet-4", { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["haiku-4", { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];
const DEFAULT: ModelPrice = { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceFor(model: string): ModelPrice {
  for (const [match, price] of PRICES) if (model.includes(match)) return price;
  return DEFAULT;
}
```

- [ ] **Step 2: Failing tests.** Create `src/providers/claude-code/today-stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeBridge } from "../../bridge/fake";
import { claudeTodayStats } from "./today-stats";

const NOW = new Date(2026, 5, 10, 14, 0); // June 10 local
const iso = NOW.toISOString();

function line(id: string, reqId: string, model: string, inTok: number, outTok: number, ts = iso) {
  return JSON.stringify({
    type: "assistant", timestamp: ts, requestId: reqId,
    message: { id, model, usage: { input_tokens: inTok, output_tokens: outTok, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

describe("claudeTodayStats", () => {
  it("sums today's tokens by model and dedupes by message.id+requestId", async () => {
    const b = new FakeBridge();
    const content = [
      line("m1", "r1", "claude-opus-4-6", 100, 50),
      line("m1", "r1", "claude-opus-4-6", 100, 50), // duplicate — must not double count
      line("m2", "r2", "claude-haiku-4-5", 10, 5),
      "not json at all", // malformed lines skipped
      line("m3", "r3", "claude-opus-4-6", 1, 1, new Date(2026, 5, 9).toISOString()), // yesterday — excluded
    ].join("\n");
    b.files.set("/Users/test/.claude/projects/p1/s1.jsonl", { content, mtimeMs: NOW.getTime() });
    const stats = await claudeTodayStats(b, NOW);
    expect(stats.tokens).toBe(165);
    expect(stats.byModel).toEqual({ "claude-opus-4-6": 150, "claude-haiku-4-5": 15 });
    // 100in/50out opus@5/25 = 0.0005+0.00125; 10in/5out haiku@1/5 = 0.00001+0.000025
    expect(stats.costUSD).toBeCloseTo(0.001785, 6);
  });
  it("returns zeros when no files", async () => {
    const stats = await claudeTodayStats(new FakeBridge(), NOW);
    expect(stats).toEqual({ tokens: 0, costUSD: 0, byModel: {} });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/providers/claude-code/today-stats.test.ts` → FAIL.

- [ ] **Step 4: Implement.** Create `src/providers/claude-code/today-stats.ts`:

```ts
import type { NativeBridge } from "../../bridge/types";
import { localDayKey, startOfTodayMs } from "../../core/time";
import type { TodayStats } from "../types";
import { priceFor } from "./pricing";

export async function claudeTodayStats(bridge: NativeBridge, now: Date): Promise<TodayStats> {
  const home = await bridge.homeDir();
  const files = await bridge.listFilesRecursive(`${home}/.claude/projects`, ".jsonl", startOfTodayMs(now));
  const today = localDayKey(now);
  const seen = new Set<string>();
  const byModel: Record<string, number> = {};
  let cost = 0;

  for (const f of files) {
    let content: string;
    try { content = await bridge.readTextFile(f.path); } catch { continue; }
    for (const lineText of content.split("\n")) {
      let entry: any;
      try { entry = JSON.parse(lineText); } catch { continue; }
      const usage = entry?.message?.usage;
      if (!usage || typeof entry.timestamp !== "string") continue;
      if (localDayKey(new Date(entry.timestamp)) !== today) continue;
      const key = `${entry.message.id ?? ""}:${entry.requestId ?? ""}`;
      if (key !== ":" && seen.has(key)) continue;
      seen.add(key);
      const model: string = entry.message.model ?? "unknown";
      const inTok = usage.input_tokens ?? 0;
      const outTok = usage.output_tokens ?? 0;
      const cacheW = usage.cache_creation_input_tokens ?? 0;
      const cacheR = usage.cache_read_input_tokens ?? 0;
      byModel[model] = (byModel[model] ?? 0) + inTok + outTok + cacheW + cacheR;
      const p = priceFor(model);
      cost += (inTok * p.in + outTok * p.out + cacheW * p.cacheWrite + cacheR * p.cacheRead) / 1_000_000;
    }
  }
  const tokens = Object.values(byModel).reduce((a, b) => a + b, 0);
  return { tokens, costUSD: cost, byModel };
}
```

- [ ] **Step 5: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 6: Commit** — `git add src && git commit -m "feat: Claude today-stats from local transcripts with dedup and pricing"`

---

### Task 7: Codex auth + limits (wham fetch + 3-shape normalizer)

**Files:** Create: `src/providers/codex/auth.ts`, `src/providers/codex/limits.ts`, `limits.test.ts`, `fixtures/codex-wham-usage.json`

- [ ] **Step 1: Fixture.** Create `fixtures/codex-wham-usage.json`:

```json
{
  "plan_type": "plus",
  "rate_limit": {
    "primary_window": { "used_percent": 47.5, "reset_at": 1781000000, "limit_window_seconds": 18000 },
    "secondary_window": { "used_percent": 12.1, "reset_at": 1781400000, "limit_window_seconds": 604800 }
  },
  "credits": { "has_credits": false, "unlimited": false, "balance": 0 }
}
```

- [ ] **Step 2: Failing tests.** Create `src/providers/codex/limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import wham from "../../../fixtures/codex-wham-usage.json";
import { FakeBridge } from "../../bridge/fake";
import { HttpError } from "../types";
import { fetchCodexLimits, normalizeCodexWindows } from "./limits";

const CAPTURED = 1780900000_000; // ms

describe("normalizeCodexWindows", () => {
  it("handles REST wham shape (limit_window_seconds + reset_at epoch sec)", () => {
    const w = normalizeCodexWindows(
      { primary: wham.rate_limit.primary_window, secondary: wham.rate_limit.secondary_window },
      CAPTURED,
    );
    expect(w).toEqual([
      { id: "session", label: "5-hour", usedPercent: 47.5, resetsAt: new Date(1781000000_000).toISOString() },
      { id: "weekly", label: "Weekly", usedPercent: 12.1, resetsAt: new Date(1781400000_000).toISOString() },
    ]);
  });
  it("handles JSONL snapshot shape (window_minutes + resets_at)", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 10, window_minutes: 300, resets_at: 1781000000 }, secondary: null },
      CAPTURED,
    );
    expect(w).toEqual([
      { id: "session", label: "5-hour", usedPercent: 10, resetsAt: new Date(1781000000_000).toISOString() },
    ]);
  });
  it("handles legacy resets_in_seconds relative to capture time", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 5, window_minutes: 300, resets_in_seconds: 60 }, secondary: null },
      CAPTURED,
    );
    expect(w[0].resetsAt).toBe(new Date(CAPTURED + 60_000).toISOString());
  });
  it("handles websocket shape (reset_after_seconds + reset_at)", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 1, window_minutes: 300, reset_after_seconds: 18000, reset_at: 1780904804 }, secondary: null },
      CAPTURED,
    );
    expect(w[0].resetsAt).toBe(new Date(1780904804_000).toISOString());
  });
  it("classifies by window_minutes when present, position otherwise", () => {
    const w = normalizeCodexWindows(
      { primary: { used_percent: 1, window_minutes: 10080 }, secondary: { used_percent: 2, window_minutes: 300 } },
      CAPTURED,
    );
    expect(w[0].id).toBe("weekly");
    expect(w[1].id).toBe("session");
  });
});

describe("fetchCodexLimits", () => {
  it("sends bearer + account id headers and normalizes", async () => {
    const b = new FakeBridge();
    b.fetchHandler = (url, init) => {
      expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
      expect(init.headers?.["Authorization"]).toBe("Bearer at-123");
      expect(init.headers?.["ChatGPT-Account-Id"]).toBe("acct-9");
      return { status: 200, headers: {}, bodyText: JSON.stringify(wham) };
    };
    const r = await fetchCodexLimits(b, { accessToken: "at-123", accountId: "acct-9" }, CAPTURED);
    expect(r.windows).toHaveLength(2);
    expect(r.planType).toBe("plus");
  });
  it("throws HttpError on failure", async () => {
    const b = new FakeBridge();
    b.fetchHandler = () => ({ status: 401, headers: {}, bodyText: "" });
    await expect(fetchCodexLimits(b, { accessToken: "x", accountId: "y" }, CAPTURED)).rejects.toThrow(HttpError);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/providers/codex` → FAIL.

- [ ] **Step 4: Implement auth reader.** Create `src/providers/codex/auth.ts`:

```ts
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
```

- [ ] **Step 5: Implement limits.** Create `src/providers/codex/limits.ts`:

```ts
import type { NativeBridge } from "../../bridge/types";
import { clampPercent, HttpError, type LimitWindow, RateLimitedError } from "../types";
import type { CodexAuth } from "./auth";

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
```

- [ ] **Step 6: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: Codex auth reader, wham fetcher, 3-shape normalizer"`

---

### Task 8: Codex JSONL fallback + today stats

**Files:** Create: `src/providers/codex/today-stats.ts`, `today-stats.test.ts`; Modify: `src/providers/codex/limits.ts` (append fallback)

- [ ] **Step 1: Failing tests.** Create `src/providers/codex/today-stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeBridge } from "../../bridge/fake";
import { codexJsonlFallback } from "./limits";
import { codexTodayStats, sessionsDirFor } from "./today-stats";

const NOW = new Date(2026, 5, 10, 14, 0);
const DIR = "/Users/test/.codex/sessions/2026/06/10";

function tokenCountLine(total: number, rateLimits: unknown = null) {
  return JSON.stringify({
    timestamp: NOW.toISOString(), type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: total } }, rate_limits: rateLimits },
  });
}

describe("sessionsDirFor", () => {
  it("zero-pads the date path", () => {
    expect(sessionsDirFor("/Users/test", new Date(2026, 5, 7))).toBe("/Users/test/.codex/sessions/2026/06/07");
  });
});

describe("codexTodayStats", () => {
  it("sums per-session cumulative MAX (guards the 91x replay overcount bug)", async () => {
    const b = new FakeBridge();
    // cumulative counter goes 100 -> 500 -> (replay) 300; max is 500, NOT 900
    b.files.set(`${DIR}/rollout-a.jsonl`, {
      content: [tokenCountLine(100), tokenCountLine(500), tokenCountLine(300)].join("\n"),
      mtimeMs: NOW.getTime(),
    });
    b.files.set(`${DIR}/rollout-b.jsonl`, { content: tokenCountLine(250), mtimeMs: NOW.getTime() });
    const stats = await codexTodayStats(b, NOW);
    expect(stats.tokens).toBe(750);
    expect(stats.costUSD).toBeUndefined(); // plan-based usage; no per-token cost
  });
  it("returns zero when today's dir is empty", async () => {
    expect((await codexTodayStats(new FakeBridge(), NOW)).tokens).toBe(0);
  });
});

describe("codexJsonlFallback", () => {
  it("returns newest non-null rate_limits snapshot, searching today then yesterday", async () => {
    const b = new FakeBridge();
    const snapshot = { primary: { used_percent: 33, window_minutes: 300, resets_at: 1781000000 }, secondary: null };
    b.files.set(`${DIR}/rollout-old.jsonl`, { content: tokenCountLine(1, null), mtimeMs: 1 });
    b.files.set(`${DIR}/rollout-new.jsonl`, {
      content: [tokenCountLine(1, null), tokenCountLine(2, snapshot)].join("\n"),
      mtimeMs: NOW.getTime(),
    });
    const w = await codexJsonlFallback(b, NOW.getTime());
    expect(w).not.toBeNull();
    expect(w![0]).toMatchObject({ id: "session", usedPercent: 33 });
  });
  it("returns null when all snapshots are null", async () => {
    const b = new FakeBridge();
    b.files.set(`${DIR}/rollout-a.jsonl`, { content: tokenCountLine(1, null), mtimeMs: NOW.getTime() });
    expect(await codexJsonlFallback(b, NOW.getTime())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/providers/codex/today-stats.test.ts` → FAIL.

- [ ] **Step 3: Implement stats.** Create `src/providers/codex/today-stats.ts`:

```ts
import type { NativeBridge } from "../../bridge/types";
import type { TodayStats } from "../types";

export function sessionsDirFor(home: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${home}/.codex/sessions/${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export async function codexTodayStats(bridge: NativeBridge, now: Date): Promise<TodayStats> {
  const home = await bridge.homeDir();
  const files = await bridge.listFilesRecursive(sessionsDirFor(home, now), ".jsonl");
  let total = 0;
  for (const f of files) {
    let content: string;
    try { content = await bridge.readTextFile(f.path); } catch { continue; }
    let maxCumulative = 0; // cumulative max per session, NOT event sum — guards replay overcount
    for (const line of content.split("\n")) {
      try {
        const t = JSON.parse(line)?.payload?.info?.total_token_usage?.total_tokens;
        if (typeof t === "number" && t > maxCumulative) maxCumulative = t;
      } catch { continue; }
    }
    total += maxCumulative;
  }
  return { tokens: total };
}
```

- [ ] **Step 4: Implement fallback.** Append to `src/providers/codex/limits.ts`:

```ts
import { sessionsDirFor } from "./today-stats"; // (move to top of file with other imports)

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
```

- [ ] **Step 5: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 6: Commit** — `git add src && git commit -m "feat: Codex JSONL fallback and replay-safe today stats"`

---

### Task 9: Active-session detection

**Files:** Create: `src/core/active-session.ts`, `active-session.test.ts`

- [ ] **Step 1: Failing tests.** Create `src/core/active-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import { claudeActiveSession, codexActiveSession } from "./active-session";

const NOW = Date.now();

describe("claudeActiveSession", () => {
  it("inactive when process not running", async () => {
    expect(await claudeActiveSession(new FakeBridge(), NOW)).toEqual({ active: false });
  });
  it("active with model from newest recent transcript", async () => {
    const b = new FakeBridge();
    b.runningProcesses = ["claude"];
    b.files.set("/Users/test/.claude/projects/p/s.jsonl", {
      content: `{"type":"assistant","message":{"model":"claude-opus-4-6"}}`,
      mtimeMs: NOW - 60_000,
    });
    expect(await claudeActiveSession(b, NOW)).toEqual({ active: true, model: "claude-opus-4-6" });
  });
  it("active without model when no recent transcript", async () => {
    const b = new FakeBridge();
    b.runningProcesses = ["claude"];
    expect(await claudeActiveSession(b, NOW)).toEqual({ active: true });
  });
});

describe("codexActiveSession", () => {
  it("detects CLI or Codex Desktop", async () => {
    const b = new FakeBridge();
    expect((await codexActiveSession(b)).active).toBe(false);
    b.runningProcesses = ["/Applications/Codex.app/Contents/MacOS/Codex"];
    expect((await codexActiveSession(b)).active).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/core/active-session.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Create `src/core/active-session.ts`:

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `git add src && git commit -m "feat: active-session detection for Claude Code and Codex"`

---

### Task 10: Provider classes + registry

**Files:** Create: `src/providers/claude-code/index.ts`, `src/providers/codex/index.ts`, `src/providers/registry.ts`, `src/providers/registry.test.ts`

- [ ] **Step 1: Failing tests.** Create `src/providers/registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/providers/registry.test.ts` → FAIL.

- [ ] **Step 3: ClaudeCodeProvider.** Create `src/providers/claude-code/index.ts`:

```ts
import type { NativeBridge } from "../../bridge/types";
import { claudeActiveSession } from "../../core/active-session";
import { CredentialError, type ActiveSession, type LimitWindow, type TodayStats, type UsageProvider } from "../types";
import { loadClaudeCredentials } from "./credentials";
import { fetchClaudeLimits } from "./limits";
import { claudeTodayStats } from "./today-stats";

const FALLBACK_CLI_VERSION = "2.1.5";

export class ClaudeCodeProvider implements UsageProvider {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";
  caption?: string;
  private cliVersion: string | null = null;

  constructor(private bridge: NativeBridge) {}

  async isConfigured(): Promise<boolean> {
    try { await loadClaudeCredentials(this.bridge); return true; } catch { return false; }
  }
  async fetchLimits(): Promise<LimitWindow[]> {
    const creds = await loadClaudeCredentials(this.bridge);
    if (creds.expiresAt > 0 && creds.expiresAt < Date.now()) throw new CredentialError("expired");
    this.caption = creds.subscriptionType;
    if (!this.cliVersion) this.cliVersion = (await this.bridge.getCliVersion("claude")) ?? FALLBACK_CLI_VERSION;
    return fetchClaudeLimits(this.bridge, creds, this.cliVersion);
  }
  fetchTodayStats(): Promise<TodayStats> { return claudeTodayStats(this.bridge, new Date()); }
  checkActiveSession(): Promise<ActiveSession> { return claudeActiveSession(this.bridge, Date.now()); }
}
```

- [ ] **Step 4: CodexProvider.** Create `src/providers/codex/index.ts`:

```ts
import type { NativeBridge } from "../../bridge/types";
import { codexActiveSession } from "../../core/active-session";
import { RateLimitedError, type ActiveSession, type LimitWindow, type TodayStats, type UsageProvider } from "../types";
import { loadCodexAuth } from "./auth";
import { codexJsonlFallback, fetchCodexLimits } from "./limits";
import { codexTodayStats } from "./today-stats";

export class CodexProvider implements UsageProvider {
  readonly id = "codex";
  readonly displayName = "Codex";
  caption?: string;

  constructor(private bridge: NativeBridge) {}

  async isConfigured(): Promise<boolean> {
    try { await loadCodexAuth(this.bridge); return true; } catch { return false; }
  }
  async fetchLimits(): Promise<LimitWindow[]> {
    const nowMs = Date.now();
    try {
      const auth = await loadCodexAuth(this.bridge);
      const result = await fetchCodexLimits(this.bridge, auth, nowMs);
      this.caption = result.planType;
      return result.windows;
    } catch (e) {
      if (e instanceof RateLimitedError) throw e; // honor cooldown, don't mask with stale fallback
      const fallback = await codexJsonlFallback(this.bridge, nowMs);
      if (fallback) return fallback;
      throw e;
    }
  }
  fetchTodayStats(): Promise<TodayStats> { return codexTodayStats(this.bridge, new Date()); }
  checkActiveSession(): Promise<ActiveSession> { return codexActiveSession(this.bridge); }
}
```

- [ ] **Step 5: Registry.** Create `src/providers/registry.ts`:

```ts
import type { NativeBridge } from "../bridge/types";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexProvider } from "./codex";
import type { UsageProvider } from "./types";

/** Adding a tool = one folder under providers/ + one line here. */
export function createProviders(bridge: NativeBridge): UsageProvider[] {
  return [new ClaudeCodeProvider(bridge), new CodexProvider(bridge)];
}
```

- [ ] **Step 6: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 7: Commit** — `git add src && git commit -m "feat: provider classes and registry"`

---

### Task 11: Store + scheduler

**Files:** Create: `src/core/store.ts`, `store.test.ts`, `src/core/scheduler.ts`, `scheduler.test.ts`

- [ ] **Step 1: Failing store test.** Create `src/core/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hudStore } from "./store";

describe("hudStore.upsert", () => {
  it("creates a default view then merges patches", () => {
    hudStore.getState().upsert("x", { displayName: "X", state: "ok" });
    hudStore.getState().upsert("x", { today: { tokens: 9 } });
    const v = hudStore.getState().providers["x"];
    expect(v.displayName).toBe("X");
    expect(v.state).toBe("ok");
    expect(v.today).toEqual({ tokens: 9 });
    expect(v.active).toEqual({ active: false });
  });
});
```

- [ ] **Step 2: Implement store.** Create `src/core/store.ts`:

```ts
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ActiveSession, LimitWindow, ProviderState, TodayStats } from "../providers/types";

export interface ProviderView {
  id: string;
  displayName: string;
  state: ProviderState;
  windows: LimitWindow[];
  asOf: number | null;          // ms of last successful limits fetch
  today: TodayStats | null;
  active: ActiveSession;
  caption?: string;             // e.g. "max" / "plus"
  note?: string;                // e.g. "re-auth in Claude Code"
}

export interface HudState {
  providers: Record<string, ProviderView>;
  upsert(id: string, patch: Partial<ProviderView>): void;
}

export const hudStore = createStore<HudState>((set) => ({
  providers: {},
  upsert: (id, patch) =>
    set((s) => {
      const prev: ProviderView = s.providers[id] ?? {
        id, displayName: id, state: "unconfigured",
        windows: [], asOf: null, today: null, active: { active: false },
      };
      return { providers: { ...s.providers, [id]: { ...prev, ...patch } } };
    }),
}));

export function useHud<T>(selector: (s: HudState) => T): T {
  return useStore(hudStore, selector);
}
```

- [ ] **Step 3: Failing scheduler tests.** Create `src/core/scheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import type { ActiveSession, LimitWindow, TodayStats, UsageProvider } from "../providers/types";
import { CredentialError, RateLimitedError } from "../providers/types";
import { Scheduler } from "./scheduler";
import type { ProviderView } from "./store";

class FakeProvider implements UsageProvider {
  id = "fake"; displayName = "Fake"; caption?: string;
  configured = true;
  fetchCount = 0;
  limitsImpl: () => Promise<LimitWindow[]> = async () => [{ id: "session", label: "S", usedPercent: 1 }];
  async isConfigured() { return this.configured; }
  async fetchLimits() { this.fetchCount++; return this.limitsImpl(); }
  async fetchTodayStats(): Promise<TodayStats> { return { tokens: 5 }; }
  async checkActiveSession(): Promise<ActiveSession> { return { active: true }; }
}

function harness(now = 1_000_000) {
  const provider = new FakeProvider();
  const bridge = new FakeBridge();
  const views = new Map<string, Partial<ProviderView>>();
  const clock = { now };
  const scheduler = new Scheduler([provider], bridge, (id, patch) => {
    views.set(id, { ...views.get(id), ...patch });
  }, { now: () => clock.now });
  return { provider, bridge, views, clock, scheduler };
}

describe("Scheduler.pollLimitsOnce", () => {
  it("ok path: updates view and writes cache", async () => {
    const { bridge, views, scheduler } = harness();
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("ok");
    expect(JSON.parse(bridge.cache.get("limits-fake")!).windows).toHaveLength(1);
  });
  it("error with no prior data -> error state", async () => {
    const { provider, views, scheduler } = harness();
    provider.limitsImpl = async () => { throw new Error("boom"); };
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("error");
  });
  it("success then failure -> stale with note for expired creds", async () => {
    const { provider, views, scheduler } = harness();
    await scheduler.pollLimitsOnce();
    provider.limitsImpl = async () => { throw new CredentialError("expired"); };
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("stale");
    expect(views.get("fake")!.note).toBe("re-auth in Fake");
  });
  it("429 sets cooldown honored until retryAfter elapses", async () => {
    const { provider, clock, scheduler } = harness();
    provider.limitsImpl = async () => { throw new RateLimitedError(120); };
    await scheduler.pollLimitsOnce();
    expect(provider.fetchCount).toBe(1);
    await scheduler.pollLimitsOnce(); // still cooling down
    expect(provider.fetchCount).toBe(1);
    clock.now += 121_000;
    provider.limitsImpl = async () => [];
    await scheduler.pollLimitsOnce();
    expect(provider.fetchCount).toBe(2);
  });
  it("unconfigured provider -> unconfigured state, no fetch", async () => {
    const { provider, views, scheduler } = harness();
    provider.configured = false;
    await scheduler.pollLimitsOnce();
    expect(views.get("fake")!.state).toBe("unconfigured");
    expect(provider.fetchCount).toBe(0);
  });
});

describe("Scheduler.restoreFromCache", () => {
  it("serves cached snapshot as stale", async () => {
    const { bridge, views, scheduler } = harness();
    bridge.cache.set("limits-fake", JSON.stringify({ windows: [{ id: "session", label: "S", usedPercent: 50 }], asOf: 123 }));
    await scheduler.restoreFromCache();
    expect(views.get("fake")!.state).toBe("stale");
    expect(views.get("fake")!.windows![0].usedPercent).toBe(50);
  });
});
```

- [ ] **Step 4: Run to verify failure** — `npx vitest run src/core/scheduler.test.ts` → FAIL.

- [ ] **Step 5: Implement scheduler.** Create `src/core/scheduler.ts`:

```ts
import type { NativeBridge } from "../bridge/types";
import { CredentialError, RateLimitedError, type UsageProvider } from "../providers/types";
import type { ProviderView } from "./store";

export interface SchedulerOpts {
  limitsMs?: number;  // network polls — 180s is the community-established safe cadence
  statsMs?: number;
  activeMs?: number;
  now?: () => number;
}
export type UpdateFn = (id: string, patch: Partial<ProviderView>) => void;

export class Scheduler {
  private cooldownUntil = new Map<string, number>();
  private hasData = new Set<string>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private limitsMs: number; private statsMs: number; private activeMs: number;
  private now: () => number;

  constructor(
    private providers: UsageProvider[],
    private bridge: NativeBridge,
    private update: UpdateFn,
    opts: SchedulerOpts = {},
  ) {
    this.limitsMs = opts.limitsMs ?? 180_000;
    this.statsMs = opts.statsMs ?? 60_000;
    this.activeMs = opts.activeMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  async start(): Promise<void> {
    for (const p of this.providers) {
      this.update(p.id, {
        id: p.id, displayName: p.displayName, state: "unconfigured",
        windows: [], asOf: null, today: null, active: { active: false },
      });
    }
    await this.restoreFromCache();
    void this.pollLimitsOnce(); void this.pollStatsOnce(); void this.pollActiveOnce();
    this.timers = [
      setInterval(() => void this.pollLimitsOnce(), this.limitsMs),
      setInterval(() => void this.pollStatsOnce(), this.statsMs),
      setInterval(() => void this.pollActiveOnce(), this.activeMs),
    ];
  }
  stop(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }
  refreshNow(): void { void this.pollLimitsOnce(true); void this.pollStatsOnce(); void this.pollActiveOnce(); }

  async restoreFromCache(): Promise<void> {
    for (const p of this.providers) {
      try {
        const raw = await this.bridge.readCache(`limits-${p.id}`);
        if (!raw) continue;
        const { windows, asOf } = JSON.parse(raw);
        this.hasData.add(p.id);
        this.update(p.id, { state: "stale", windows, asOf });
      } catch { /* corrupt cache — ignore, fresh poll will overwrite */ }
    }
  }

  async pollLimitsOnce(force = false): Promise<void> {
    for (const p of this.providers) {
      const now = this.now();
      if (!force && (this.cooldownUntil.get(p.id) ?? 0) > now) continue;
      try {
        if (!(await p.isConfigured())) {
          if (!this.hasData.has(p.id)) this.update(p.id, { state: "unconfigured" });
          continue;
        }
        const windows = await p.fetchLimits();
        this.hasData.add(p.id);
        this.update(p.id, { state: "ok", windows, asOf: now, caption: p.caption, note: undefined });
        await this.bridge.writeCache(`limits-${p.id}`, JSON.stringify({ windows, asOf: now }));
      } catch (e) {
        if (e instanceof RateLimitedError) {
          this.cooldownUntil.set(p.id, now + (e.retryAfterSec ?? 300) * 1000);
        }
        const note = e instanceof CredentialError && e.reason === "expired"
          ? `re-auth in ${p.displayName}`
          : (e as Error).message;
        this.update(p.id, { state: this.hasData.has(p.id) ? "stale" : "error", note });
      }
    }
  }
  async pollStatsOnce(): Promise<void> {
    for (const p of this.providers) {
      try { this.update(p.id, { today: await p.fetchTodayStats() }); } catch { /* best-effort */ }
    }
  }
  async pollActiveOnce(): Promise<void> {
    for (const p of this.providers) {
      try { this.update(p.id, { active: await p.checkActiveSession() }); } catch { /* best-effort */ }
    }
  }
}
```

- [ ] **Step 6: Run tests** — `npx vitest run` → PASS.
- [ ] **Step 7: Commit** — `git add src && git commit -m "feat: polling scheduler with cache-first degradation and store"`

---

### Task 12: Probe CLI

**Files:** Create: `src/probe.ts`

- [ ] **Step 1: Implement.** Create `src/probe.ts` (must import ONLY `bridge/node`, never `bridge/tauri`):

```ts
import { NodeBridge } from "./bridge/node";
import { formatCountdown } from "./core/time";
import { createProviders } from "./providers/registry";

async function main() {
  const bridge = new NodeBridge();
  for (const p of createProviders(bridge)) {
    console.log(`\n=== ${p.displayName} (${p.id}) ===`);
    if (!(await p.isConfigured())) { console.log("  not configured"); continue; }
    try {
      const windows = await p.fetchLimits();
      if (p.caption) console.log(`  plan: ${p.caption}`);
      for (const w of windows) {
        const rem = w.resetsAt ? formatCountdown(new Date(w.resetsAt).getTime() - Date.now()) : "—";
        console.log(`  ${w.label.padEnd(14)} ${w.usedPercent.toFixed(1).padStart(5)}%   resets in ${rem}`);
      }
    } catch (e) { console.log(`  limits error: ${(e as Error).message}`); }
    try {
      const t = await p.fetchTodayStats();
      const cost = t.costUSD !== undefined && t.costUSD > 0 ? ` · ≈$${t.costUSD.toFixed(2)}` : "";
      console.log(`  today: ${t.tokens.toLocaleString()} tokens${cost}`);
    } catch (e) { console.log(`  stats error: ${(e as Error).message}`); }
    const a = await p.checkActiveSession();
    console.log(`  active session: ${a.active}${a.model ? ` (${a.model})` : ""}`);
  }
}
main();
```

- [ ] **Step 2: Smoke test against the real machine**

Run: `npm run probe`
Expected: both providers print real limit percentages with countdowns, today's tokens, and active flags. **First run pops a macOS Keychain dialog — click "Always Allow".** If the Claude endpoint is disabled for this account, expect `limits error: http-4xx` (the widget will rely on cache; this is the documented degradation path, not a bug).

- [ ] **Step 3: Commit** — `git add src package.json && git commit -m "feat: probe CLI smoke test for the full data path"`

---

### Task 13: UI

**Files:** Create: `src/ui/colors.ts`, `colors.test.ts`, `src/ui/format.ts`, `format.test.ts`, `src/ui/theme.css`, `src/ui/LimitBar.tsx`, `src/ui/ProviderCard.tsx`, `src/ui/App.tsx`; Modify: `src/main.tsx`, `src-tauri/capabilities/default.json`, `index.html`

- [ ] **Step 1: Failing tests for pure helpers.** Create `src/ui/colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { barColor } from "./colors";

describe("barColor", () => {
  it("neutral below 70", () => expect(barColor(69.9)).toBe("var(--accent)"));
  it("amber at 70+", () => expect(barColor(70)).toBe("var(--amber)"));
  it("red at 90+", () => expect(barColor(90)).toBe("var(--red)"));
});
```

And `src/ui/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTokens } from "./format";

describe("formatTokens", () => {
  it("millions", () => expect(formatTokens(1_234_567)).toBe("1.2M"));
  it("thousands", () => expect(formatTokens(45_600)).toBe("45.6k"));
  it("small", () => expect(formatTokens(999)).toBe("999"));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/ui` → FAIL.

- [ ] **Step 3: Implement helpers.** Create `src/ui/colors.ts`:

```ts
/** Claude Code's own convention: neutral -> amber at 70% -> red at 90%. */
export function barColor(usedPercent: number): string {
  if (usedPercent >= 90) return "var(--red)";
  if (usedPercent >= 70) return "var(--amber)";
  return "var(--accent)";
}
```

And `src/ui/format.ts`:

```ts
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run` → PASS.

- [ ] **Step 5: Theme.** Create `src/ui/theme.css`:

```css
:root {
  --bg: rgba(38, 38, 36, 0.85);      /* Claude #262624 @ 85% */
  --text: #faf9f5;
  --muted: rgba(250, 249, 245, 0.55);
  --accent: #d97757;                  /* Claude orange */
  --amber: #ffb224;
  --red: #e5484d;
  --green: #46a758;
  --track: rgba(250, 249, 245, 0.12);
}
* { box-sizing: border-box; margin: 0; }
html, body, #root { background: transparent; }
body {
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
.panel { background: var(--bg); border-radius: 12px; padding: 12px 14px; margin: 4px; }
.panel-header { font-size: 13px; font-weight: 600; color: var(--accent); margin-bottom: 10px; cursor: default; }
.card { padding: 8px 0; border-top: 1px solid var(--track); }
.card-stale { opacity: 0.6; }
.card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.card-title { font-weight: 600; }
.caption { color: var(--muted); font-size: 10px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.dot-on { background: var(--green); }
.bar-row { margin: 5px 0; }
.bar-meta { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px; }
.bar-track { height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
.muted { color: var(--muted); font-size: 10px; margin-top: 3px; }
.today { color: var(--muted); font-size: 11px; margin-top: 5px; }
```

- [ ] **Step 6: Components.** Create `src/ui/LimitBar.tsx`:

```tsx
import { formatCountdown } from "../core/time";
import type { LimitWindow } from "../providers/types";
import { barColor } from "./colors";

export default function LimitBar({ window: w, nowMs }: { window: LimitWindow; nowMs: number }) {
  const remaining = w.resetsAt ? new Date(w.resetsAt).getTime() - nowMs : null;
  return (
    <div className="bar-row">
      <div className="bar-meta">
        <span>{w.label}</span>
        <span>
          {Math.round(w.usedPercent)}%
          {remaining !== null && <span className="caption"> · ↻ {formatCountdown(remaining)}</span>}
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${w.usedPercent}%`, background: barColor(w.usedPercent) }} />
      </div>
    </div>
  );
}
```

Create `src/ui/ProviderCard.tsx`:

```tsx
import type { ProviderView } from "../core/store";
import { formatTokens } from "./format";
import LimitBar from "./LimitBar";

export default function ProviderCard({ view, nowMs }: { view: ProviderView; nowMs: number }) {
  const stale = view.state === "stale";
  const asOfMin = view.asOf ? Math.round((nowMs - view.asOf) / 60_000) : null;
  return (
    <div className={`card ${stale ? "card-stale" : ""}`}>
      <div className="card-header">
        <span className={`dot ${view.active.active ? "dot-on" : ""}`} />
        <span className="card-title">{view.displayName}</span>
        {view.caption && <span className="caption">{view.caption}</span>}
        {view.active.model && <span className="caption">{view.active.model}</span>}
      </div>
      {view.state === "unconfigured" ? (
        <div className="muted">not set up</div>
      ) : (
        <>
          {view.windows.map((w) => <LimitBar key={w.id} window={w} nowMs={nowMs} />)}
          {stale && asOfMin !== null && asOfMin > 5 && <div className="muted">as of {asOfMin}m ago</div>}
          {view.note && <div className="muted">⚠ {view.note}</div>}
          {view.today && (
            <div className="today">
              today: {formatTokens(view.today.tokens)} tokens
              {view.today.costUSD !== undefined && view.today.costUSD > 0 && <> · ≈${view.today.costUSD.toFixed(2)}</>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

Create `src/ui/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useHud } from "../core/store";
import ProviderCard from "./ProviderCard";

export default function App() {
  const providers = useHud((s) => s.providers);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="panel">
      <div className="panel-header" data-tauri-drag-region>⚡ AI Usage</div>
      {Object.values(providers).map((v) => <ProviderCard key={v.id} view={v} nowMs={nowMs} />)}
    </div>
  );
}
```

- [ ] **Step 7: Entry point.** Replace `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { TauriBridge } from "./bridge/tauri";
import { Scheduler } from "./core/scheduler";
import { hudStore } from "./core/store";
import { createProviders } from "./providers/registry";
import App from "./ui/App";
import "./ui/theme.css";

const bridge = new TauriBridge();
const scheduler = new Scheduler(
  createProviders(bridge), bridge,
  (id, patch) => hudStore.getState().upsert(id, patch),
);

async function restorePosition() {
  try {
    const raw = await bridge.readCache("window-pos");
    if (raw) {
      const { x, y } = JSON.parse(raw);
      await getCurrentWindow().setPosition(new PhysicalPosition(x, y));
    }
  } catch { /* default position is fine */ }
}
function watchPosition() {
  let t: ReturnType<typeof setTimeout> | undefined;
  void getCurrentWindow().onMoved(({ payload }) => {
    clearTimeout(t);
    t = setTimeout(() => void bridge.writeCache("window-pos", JSON.stringify({ x: payload.x, y: payload.y })), 500);
  });
}
void restorePosition().then(() => { watchPosition(); return scheduler.start(); });
void listen<string>("tray-action", (e) => { if (e.payload === "refresh") scheduler.refreshNow(); });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

Delete the scaffold's `src/App.css` and any scaffold demo markup/imports; in `index.html` keep only the root div and ensure `<body style="background: transparent">` is NOT set via inline attrs (theme.css already handles it).

- [ ] **Step 8: Window permissions.** Add to the `permissions` array in `src-tauri/capabilities/default.json`:

```json
"core:window:allow-set-position",
"core:window:allow-start-dragging"
```

- [ ] **Step 9: Visual verification** — Run: `npm run tauri dev`. Expected: dark warm panel with both provider cards, real percentages, ticking countdowns, today lines, active dots. (Window still at normal level until Task 14.)

- [ ] **Step 10: Commit** — `git add -A && git commit -m "feat: HUD UI with Claude palette, bars, countdowns, cards"`

---

### Task 14: Desktop pinning, tray, autostart

**Files:** Create: `src-tauri/src/desktop_pin.rs`, `src-tauri/src/tray.rs`; Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add objc2.** In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
objc2 = "0.6"
```

- [ ] **Step 2: Pinning glue.** Create `src-tauri/src/desktop_pin.rs`:

```rust
use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool};
use tauri::WebviewWindow;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}

const KEY_DESKTOP: i32 = 2;  // kCGDesktopWindowLevelKey  -> level ~ -2147483623
const KEY_NORMAL: i32 = 4;   // kCGNormalWindowLevelKey   -> level 0
const KEY_FLOATING: i32 = 5; // kCGFloatingWindowLevelKey -> level 3

struct SendPtr(*mut AnyObject);
unsafe impl Send for SendPtr {}

fn apply(window: &WebviewWindow, level: i64, ignore_mouse: bool) -> Result<(), String> {
    let ptr = SendPtr(window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject);
    window
        .run_on_main_thread(move || unsafe {
            let w = ptr.0;
            let _: () = msg_send![w, setLevel: level as isize];
            // CanJoinAllSpaces(1<<0) | Stationary(1<<4) | IgnoresCycle(1<<6)
            // Stationary: survives Mission Control / Show Desktop. (Übersicht's exact recipe.)
            let behavior: usize = (1 << 0) | (1 << 4) | (1 << 6);
            let _: () = msg_send![w, setCollectionBehavior: behavior];
            let _: () = msg_send![w, setIgnoresMouseEvents: Bool::from(ignore_mouse)];
        })
        .map_err(|e| e.to_string())
}

/// pinned: wallpaper layer, click-through. float: above all apps, interactive.
/// arrange: just below normal windows, interactive (for dragging into place).
pub fn apply_mode(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    let (level, ignore_mouse) = unsafe {
        match mode {
            "pinned" => (CGWindowLevelForKey(KEY_DESKTOP) as i64, true),
            "float" => (CGWindowLevelForKey(KEY_FLOATING) as i64, false),
            "arrange" => (CGWindowLevelForKey(KEY_NORMAL) as i64 - 1, false),
            _ => return Err(format!("unknown mode: {mode}")),
        }
    };
    apply(window, level, ignore_mouse)
}
```

- [ ] **Step 3: Mode command.** Append to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn set_window_mode(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    crate::desktop_pin::apply_mode(&window, &mode)
}
```

- [ ] **Step 4: Tray.** Create `src-tauri/src/tray.rs`:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

static FLOAT: AtomicBool = AtomicBool::new(false);
static ARRANGING: AtomicBool = AtomicBool::new(false);

fn current_mode() -> &'static str {
    if ARRANGING.load(Ordering::SeqCst) { "arrange" }
    else if FLOAT.load(Ordering::SeqCst) { "float" }
    else { "pinned" }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let arrange = CheckMenuItem::with_id(app, "arrange", "Arrange (drag to move)", true, false, None::<&str>)?;
    let float = CheckMenuItem::with_id(app, "float", "Float on top", true, false, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at login", true, autostart_enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .items(&[&arrange, &float, &refresh, &autostart, &quit])
        .build()?;

    let arrange_c = arrange.clone();
    let float_c = float.clone();
    let autostart_c = autostart.clone();

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let win = app.get_webview_window("main").expect("main window");
            match event.id().as_ref() {
                "arrange" => {
                    let new = !ARRANGING.load(Ordering::SeqCst);
                    ARRANGING.store(new, Ordering::SeqCst);
                    let _ = arrange_c.set_checked(new);
                    let _ = crate::desktop_pin::apply_mode(&win, current_mode());
                }
                "float" => {
                    let new = !FLOAT.load(Ordering::SeqCst);
                    FLOAT.store(new, Ordering::SeqCst);
                    let _ = float_c.set_checked(new);
                    let _ = crate::desktop_pin::apply_mode(&win, current_mode());
                }
                "refresh" => { let _ = app.emit("tray-action", "refresh"); }
                "autostart" => {
                    let al = app.autolaunch();
                    let enabled = al.is_enabled().unwrap_or(false);
                    let _ = if enabled { al.disable() } else { al.enable() };
                    let _ = autostart_c.set_checked(!enabled);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}
```

- [ ] **Step 5: Wire up lib.rs.** In `src-tauri/src/lib.rs`: add `mod desktop_pin; mod tray;` next to `mod commands;`, add `commands::set_window_mode` to `generate_handler![...]`, ensure tauri has the tray feature in Cargo.toml (`tauri = { version = "2", features = ["tray-icon", "image-png"] }`), and add a setup hook to the builder:

```rust
.setup(|app| {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory); // no Dock icon
    tray::setup(app.handle())?;
    let win = app.get_webview_window("main").expect("main window");
    if let Err(e) = desktop_pin::apply_mode(&win, "pinned") {
        eprintln!("desktop pin failed (window stays at normal level): {e}");
    }
    Ok(())
})
```

(Pinning failure must not crash the app — log and continue at normal window level.)

- [ ] **Step 6: Autostart on by default (first run only).** The spec says launch-at-login defaults to ON but stays user-toggleable. Append to `src/main.tsx` (after the `restorePosition().then(...)` line):

```tsx
import { enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";

async function initAutostartDefault() {
  try {
    if ((await bridge.readCache("autostart-initialized")) === null) {
      if (!(await autostartEnabled())) await enableAutostart();
      await bridge.writeCache("autostart-initialized", "1");
    }
  } catch { /* autostart is a nicety; never block startup */ }
}
void initAutostartDefault();
```

(Move the import to the top of the file with the others. Known cosmetic quirk: on the very first launch the tray checkbox was rendered before this runs, so it shows unchecked until the next launch — acceptable.)

- [ ] **Step 7: Build check** — Run: `cd src-tauri && cargo check && cd ..` → compiles clean. Then `npx tsc --noEmit` → clean.

- [ ] **Step 8: Manual verification** — Run: `npm run tauri dev` and verify each:
  - Widget renders ON the wallpaper: open any app window over it — widget stays behind.
  - Press F11/Show Desktop — widget remains visible (Stationary).
  - Open Mission Control — widget does NOT appear as a window thumbnail.
  - Clicks pass through the widget to desktop icons beneath it.
  - Tray → Arrange: widget becomes draggable; drag it, uncheck Arrange; it re-pins. Quit and relaunch: position restored.
  - Tray → Float on top: widget overlays all apps, draggable via header.
  - Tray → Refresh now: percentages update immediately.
  - No Dock icon; app visible only as tray icon + widget.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat: desktop-layer pinning, tray controls, autostart"`

---

### Task 15: README + final verification

**Files:** Create: `README.md`

- [ ] **Step 1: README.** Create `README.md`:

```markdown
# AI Usage HUD

A macOS desktop widget pinned to the wallpaper layer showing live usage limits
for Claude Code and Codex — session/weekly bars, reset countdowns, today's
token/cost stats, and active-session dots. Tauri 2 + TypeScript.

## Run

- `npm install`
- `npm run tauri dev` — run the widget
- `npm run tauri build` — produce the .app bundle
- `npm test` — unit tests
- `npm run probe` — print all provider data in the terminal (no UI)

First run pops one macOS Keychain prompt for "Claude Code-credentials" —
click **Always Allow**.

## Controls

Everything is in the menu bar tray icon: Arrange (drag to move), Float on top,
Refresh now, Launch at login, Quit. The widget is click-through while pinned.

## How it reads your data

- Claude Code: OAuth token from your Keychain → `api.anthropic.com/api/oauth/usage`
  (the same numbers as `/usage`). Today's stats parsed from `~/.claude/projects` logs.
- Codex: token from `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`
  (the same numbers as `/status`). Fallback: session logs. Today's stats from session logs.
- Tokens are read-only and never refreshed, stored, or sent anywhere else.
  Network egress is allowlisted to those two hosts. No telemetry.
- Both endpoints are undocumented — expect occasional breakage when they change.

## Known macOS quirks

- "Click wallpaper to reveal desktop" (Sonoma+, System Settings → Desktop & Dock)
  sweeps app windows aside when you click the widget's area. The widget stays put.
- Adding a provider: one folder under `src/providers/` + one line in `registry.ts`.
```

- [ ] **Step 2: Full test suite + probe one last time**

Run: `npm test && npm run probe` → all green, real data prints.

- [ ] **Step 3: Commit** — `git add README.md && git commit -m "docs: README with security posture and quirks"`

---

## Manual acceptance checklist (run after Task 15)

- [ ] Widget shows both tools with real percentages matching `/usage` and `/status`
- [ ] Countdown ticks every second; bars amber ≥70%, red ≥90%
- [ ] Turn off Wi-Fi → within one poll cycle cards dim with "as of Nm ago"; turn on → recovers
- [ ] Run a Claude Code session → green dot + model appear within ~20s
- [ ] All Task 14 window behaviors pass
- [ ] `npm test` green; `npm run probe` prints sane data

