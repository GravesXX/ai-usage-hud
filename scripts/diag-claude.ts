// Diagnostic: hit the Claude usage endpoint exactly like the app does and print
// the RAW status + body (never the token), so we can see WHY limits fail.
import { NodeBridge } from "../src/bridge/node";
import { loadClaudeCredentials } from "../src/providers/claude-code/credentials";

async function main() {
  const bridge = new NodeBridge();
  let creds;
  try {
    creds = await loadClaudeCredentials(bridge);
  } catch (e) {
    console.log("credential load failed:", (e as Error).message);
    return;
  }
  const now = Date.now();
  console.log("expiresAt:", creds.expiresAt, "| now:", now, "| clock-expired:", creds.expiresAt > 0 && creds.expiresAt < now);
  console.log("subscriptionType:", creds.subscriptionType, "| accessToken length:", creds.accessToken.length, "| prefix:", creds.accessToken.slice(0, 12) + "...");

  const cliVersion = (await bridge.getCliVersion("claude")) ?? "2.1.5";
  console.log("cliVersion sent in UA:", cliVersion);

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
  console.log("HTTP status:", resp.status);
  console.log("retry-after:", resp.headers["retry-after"] ?? "(none)");
  console.log("body (first 600 chars):", resp.bodyText.slice(0, 600));
}
main();
