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
