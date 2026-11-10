import { useCallback, useEffect, useState } from "react";
import { applyUpdate, checkForUpdates, errorMessage, restartApp, type UpdateStatus } from "../api";

const CHECK_INTERVAL = 30 * 60 * 1000;

type Phase = "idle" | "checking" | "updating" | "updated" | "restarting";

export interface Updates {
  status: UpdateStatus | null;
  phase: Phase;
  error: string | null;
  /** The banner was closed for this version; it shows again when a newer one appears. */
  dismissed: boolean;
  check(): void;
  update(): void;
  restart(): void;
  dismiss(): void;
}

/** Checks for a newer version on the current branch at startup and every 30 minutes. */
export function useUpdates(): Updates {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const check = useCallback(() => {
    setPhase((current) => (current === "idle" ? "checking" : current));
    setError(null);
    checkForUpdates()
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setPhase((current) => (current === "checking" ? "idle" : current)));
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [check]);

  const update = () => {
    setPhase("updating");
    setError(null);
    applyUpdate()
      .then(() => setPhase("updated"))
      .catch((err) => {
        setError(errorMessage(err));
        setPhase("idle");
      });
  };

  const restart = () => {
    setPhase("restarting");
    restartApp().catch((err) => {
      setError(errorMessage(err));
      setPhase("updated");
    });
  };

  return {
    status,
    phase,
    error,
    dismissed: dismissedAt !== null && dismissedAt === status?.latest,
    check,
    update,
    restart,
    dismiss: () => setDismissedAt(status?.latest ?? null),
  };
}

const bannerButtonClass =
  "rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50 bg-white/90 text-blue-700 hover:bg-white";

/** Bar at the top of the window when a newer version is available. */
export function UpdateBanner({ updates }: { updates: Updates }) {
  const { status, phase, error, dismissed } = updates;
  const updating = phase === "updating" || phase === "updated" || phase === "restarting";
  if (!updating && (status?.state !== "behind" || dismissed)) return null;

  let message: string;
  if (phase === "updated") message = "Update downloaded. Restart the app to use the new version.";
  else if (phase === "restarting") message = "Restarting... The app opens again after installing and building.";
  else if (phase === "updating") message = "Updating...";
  else {
    const count = status?.behind ?? 0;
    message = `A new version is available: ${count} new ${count === 1 ? "change" : "changes"} on ${status?.upstream}.`;
  }

  return (
    <div className="shrink-0 bg-blue-600 px-4 py-2 text-sm text-white">
      <div className="flex items-center gap-3">
        <p className="flex-1 truncate" title={status?.changes?.join("\n")}>
          {message}
          {phase === "idle" && status?.changes?.[0] && (
            <span className="text-blue-100"> Latest: {status.changes[0]}</span>
          )}
        </p>
        {phase === "updated" || phase === "restarting" ? (
          <button
            type="button"
            className={bannerButtonClass}
            disabled={phase === "restarting"}
            onClick={updates.restart}
          >
            Restart now
          </button>
        ) : (
          <button type="button" className={bannerButtonClass} disabled={phase === "updating"} onClick={updates.update}>
            Update
          </button>
        )}
        {phase === "idle" && (
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            className="rounded-md px-2 py-1 hover:bg-blue-700"
            onClick={updates.dismiss}
          >
            ✕
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-red-100">{error}</p>}
    </div>
  );
}

/** Version and update check at the bottom of the sidebar. */
export function UpdateStatusFooter({ updates }: { updates: Updates }) {
  const { status, phase, error } = updates;
  // Otherwise the banner shows the error.
  const bannerVisible = status?.state === "behind" && !updates.dismissed;

  let summary = "Checking for updates...";
  if (status?.state === "up-to-date") summary = "Up to date";
  else if (status?.state === "behind")
    summary = `${status.behind} new ${status.behind === 1 ? "change" : "changes"} available`;
  else if (status?.state === "unavailable") summary = status.reason ?? "Updates unavailable";
  if (status?.state === "up-to-date" && status.ahead) summary += ` (${status.ahead} local, not pushed)`;

  return (
    <div className="mt-auto flex flex-col gap-1 px-3 text-xs text-gray-500">
      <span>
        Version {status?.version ?? "..."}
        {status?.branch && (
          <>
            {" · "}
            {status.branch}
            {status.current && ` @ ${status.current}`}
          </>
        )}
      </span>
      <span className={status?.state === "behind" ? "text-blue-600 dark:text-blue-400" : ""}>{summary}</span>
      {error && phase === "idle" && !bannerVisible && <span className="text-red-600 dark:text-red-400">{error}</span>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={phase !== "idle"}
          onClick={updates.check}
          className="self-start font-medium text-gray-700 hover:underline disabled:opacity-50 dark:text-gray-300"
        >
          {phase === "checking" ? "Checking..." : "Check for updates"}
        </button>
        {status?.state === "behind" && phase === "idle" && (
          <button
            type="button"
            onClick={updates.update}
            className="self-start font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Update
          </button>
        )}
      </div>
    </div>
  );
}
