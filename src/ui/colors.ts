/** Claude Code's own convention: neutral -> amber at 70% -> red at 90%. */
export function barColor(usedPercent: number): string {
  if (usedPercent >= 90) return "var(--red)";
  if (usedPercent >= 70) return "var(--amber)";
  return "var(--accent)";
}
