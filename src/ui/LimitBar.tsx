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
