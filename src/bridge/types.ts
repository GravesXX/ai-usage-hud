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
  /** Recursive file listing filtered by suffix; modifiedAfterMs is INCLUSIVE (mtime >= boundary). All bridge implementations must match. */
  listFilesRecursive(root: string, suffix: string, modifiedAfterMs?: number): Promise<FileInfo[]>;
  fetch(url: string, init: FetchInit): Promise<FetchResult>;
  checkProcesses(queries: ProcQuery[]): Promise<boolean[]>;
  getCliVersion(command: "claude" | "codex"): Promise<string | null>;
  readCache(key: string): Promise<string | null>;
  writeCache(key: string, value: string): Promise<void>;
  homeDir(): Promise<string>;
}
