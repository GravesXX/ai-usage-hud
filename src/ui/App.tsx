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
