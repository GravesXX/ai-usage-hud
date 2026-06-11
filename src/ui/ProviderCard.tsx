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
