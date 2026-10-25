import { useState } from "react";
import { call, formatSeconds, useElapsed, useStatus } from "../shared";

// Floating always-on-top window shown while recording. The main process
// closes it when the recording ends, however it ends.
export default function RecordingOverlay() {
  const [status] = useStatus();
  const elapsed = useElapsed(status);
  const [stopping, setStopping] = useState(false);

  async function stop() {
    setStopping(true);
    try {
      await call("stop");
    } catch {
      setStopping(false);
    }
  }

  return (
    <div className="flex h-screen items-center gap-3 overflow-hidden bg-gray-900 px-3 text-white select-none">
      {/* The window is frameless: this area drags it. */}
      <div
        className="flex flex-1 cursor-move items-center gap-2 self-stretch [-webkit-app-region:drag]"
        title="Drag to move"
      >
        <span className="size-3 animate-pulse rounded-full bg-red-500" />
        <span className="text-xs font-semibold tracking-wider text-red-400">REC</span>
        <span className="font-mono text-sm tabular-nums">{formatSeconds(elapsed)}</span>
      </div>
      <button
        type="button"
        onClick={stop}
        disabled={stopping || status?.state === "saving"}
        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
      >
        <span className="size-2.5 rounded-xs bg-white" />
        {stopping || status?.state === "saving" ? "Saving..." : "Stop"}
      </button>
    </div>
  );
}
