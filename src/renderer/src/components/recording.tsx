import { useEffect, useState } from "react";
import { callTool, errorMessage, onToolEvent } from "../api";
import type { RecordingStatus } from "../../../main/lib/recording";
import { Field, secondaryButtonClass } from "./ui";

// Shared UI for tools whose main-process API follows src/main/lib/recording.ts:
// getStatus(), start(settings), stop(), chooseFolder(), openFolder(), and
// "status" events.

export type { RecordingStatus };

export function formatSeconds(seconds: number) {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The tool's recording status, kept up to date by its "status" events. */
export function useRecordingStatus(toolId: string) {
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  useEffect(() => {
    callTool<RecordingStatus>(toolId, "getStatus").then(setStatus);
    return onToolEvent(toolId, "status", (payload) => setStatus(payload as RecordingStatus));
  }, [toolId]);
  return [status, setStatus] as const;
}

/** Seconds recorded so far, or the length of the last recording. */
export function useElapsed(status: RecordingStatus | null) {
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

export function SaveToField({
  toolId,
  folder,
  disabled,
  onChange,
  onError,
}: {
  toolId: string;
  folder: string;
  disabled: boolean;
  onChange: (folder: string) => void;
  onError: (message: string) => void;
}) {
  async function browse() {
    try {
      onChange(await callTool<string>(toolId, "chooseFolder"));
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  return (
    <Field label="Save to">
      <span className="min-w-0 flex-1 truncate text-sm" title={folder}>
        {folder}
      </span>
      <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={browse}>
        Browse...
      </button>
    </Field>
  );
}

function StatusLine({ status, elapsed, error }: { status: RecordingStatus; elapsed: number; error: string | null }) {
  if (error) {
    return <p className="text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">{error}</p>;
  }
  if (status.state === "recording") {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
        <span className="size-2.5 animate-pulse rounded-full bg-red-600" />
        Recording... {formatSeconds(elapsed)}
      </p>
    );
  }
  if (status.state === "saving") return <p className="text-sm text-gray-500">Saving...</p>;
  if (status.state === "starting") return <p className="text-sm text-gray-500">Starting...</p>;
  if (status.output) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Saved {status.output} ({formatSeconds(elapsed)})
      </p>
    );
  }
  return <p className="text-sm text-gray-500">Ready.</p>;
}

/** Start/stop button, "Open folder" and the status line. */
export function RecordControls({
  toolId,
  status,
  busy,
  error,
  canStart = true,
  onToggle,
  onError,
}: {
  toolId: string;
  status: RecordingStatus;
  busy: boolean;
  error: string | null;
  canStart?: boolean;
  onToggle: () => void;
  onError: (message: string) => void;
}) {
  const elapsed = useElapsed(status);
  const label = {
    idle: "Start recording",
    starting: "Starting...",
    recording: "Stop recording",
    saving: "Saving...",
  }[status.state];
  const disabled = busy || status.state === "starting" || status.state === "saving" || (status.state === "idle" && !canStart);

  return (
    <>
      <div className="mt-8 mb-4 flex gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className={`w-44 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
            status.state === "recording" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {label}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => callTool(toolId, "openFolder").catch((err) => onError(errorMessage(err)))}
        >
          Open folder
        </button>
      </div>
      <StatusLine status={status} elapsed={elapsed} error={error ?? status.error} />
    </>
  );
}
