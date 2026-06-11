import type { NativeBridge } from "../bridge/types";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexProvider } from "./codex";
import type { UsageProvider } from "./types";

/** Adding a tool = one folder under providers/ + one line here. */
export function createProviders(bridge: NativeBridge): UsageProvider[] {
  return [new ClaudeCodeProvider(bridge), new CodexProvider(bridge)];
}
