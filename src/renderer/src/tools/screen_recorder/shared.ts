import { useEffect, useState } from "react";
import { callTool, onToolEvent } from "../../api";
import type { Status } from "../../../../main/tools/screen_recorder";

export type { Options, Settings, Source, Status } from "../../../../main/tools/screen_recorder";

export const TOOL_ID = "screen_recorder";

export const call = <T = unknown>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

export function formatSeconds(seconds: number) {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The recording status, kept up to date by events from the main process. */
export function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    call<Status>("getStatus").then(setStatus);
    return onToolEvent(TOOL_ID, "status", (payload) => setStatus(payload as Status));
  }, []);
  return [status, setStatus] as const;
}

/** Seconds recorded so far, or the length of the last recording. */
export function useElapsed(status: Status | null) {
  const [now, setNow] = useState(Date.now());
  const running = status?.startedAt != null && (status.state === "recording" || status.state === "saving");
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);
  if (!status) return 0;
  return running ? Math.max(0, (now - status.startedAt!) / 1000) : status.duration;
}
