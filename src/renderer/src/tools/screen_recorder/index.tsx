import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api";
import {
  call,
  formatSeconds,
  useElapsed,
  useStatus,
  type Options,
  type Settings,
  type Source,
  type Status,
} from "./shared";

const inputClass =
  "w-80 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 " +
  "dark:border-gray-700 dark:bg-gray-900";
const secondaryButtonClass =
  "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 " +
  "dark:border-gray-700 dark:hover:bg-gray-800";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-4">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex min-w-0 items-center gap-3">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  disabled,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            value === option.value ? "bg-blue-600 text-white" : "hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SourceSelect({
  sources,
  value,
  disabled,
  onChange,
}: {
  sources: Source[];
  value: string | null;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <select className={inputClass} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {sources.length === 0 && <option value="">Nothing found</option>}
      {sources.map((source) => (
        <option key={source.id} value={source.id}>
          {source.name}
        </option>
      ))}
    </select>
  );
}

function StatusLine({ status, elapsed, error }: { status: Status; elapsed: number; error: string | null }) {
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

export default function ScreenRecorder() {
  const [options, setOptions] = useState<Options | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [status, setStatus] = useStatus();
  const elapsed = useElapsed(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Options>("options")
      .then((opts) => {
        setOptions(opts);
        setSettings(opts.settings);
        setFolder(opts.folder);
        setStatus(opts.status);
      })
      .catch((err) => setError(errorMessage(err)));
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setMicrophones(devices.filter((device) => device.kind === "audioinput")))
      .catch(() => {});
  }, [setStatus]);

  const update = (changes: Partial<Settings>) => setSettings((current) => current && { ...current, ...changes });

  async function refreshSources() {
    try {
      const sources = await call<Source[]>("listSources");
      const screens = sources.filter((source) => source.type === "screen");
      const windows = sources.filter((source) => source.type === "window");
      setOptions((current) => current && { ...current, screens, windows });
      // Keep the selections that still exist, otherwise pick the first one.
      setSettings(
        (current) =>
          current && {
            ...current,
            screenId: screens.some((s) => s.id === current.screenId) ? current.screenId : (screens[0]?.id ?? null),
            windowId: windows.some((w) => w.id === current.windowId) ? current.windowId : (windows[0]?.id ?? null),
          },
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function selectSource(source: Settings["source"]) {
    update({ source });
    if (source === "window") refreshSources();
  }

  async function toggleRecording() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call<Status>(status?.state === "recording" ? "stop" : "start", settings));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    try {
      setFolder(await call<string>("chooseFolder"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!options || !settings || !status) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>;
  }

  const locked = status.state !== "idle" || busy;
  const recordLabel = {
    idle: "Start recording",
    starting: "Starting...",
    recording: "Stop recording",
    saving: "Saving...",
  }[status.state];

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Screen Recorder</h2>
      <p className="mt-1 mb-8 text-sm text-gray-500">
        Record a screen or a single window, optionally with audio. While recording, this window is minimized and a
        floating timer with a stop button is shown; it does not appear in the video.
      </p>

      {options.warning && (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {options.warning}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {options.usesSystemPicker ? (
          <Field label="Record">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Your system will ask which screen or window to record.
            </span>
          </Field>
        ) : (
          <>
            <Field label="Record">
              <Segmented
                options={[
                  { value: "screen", label: "Screen" },
                  { value: "window", label: "Window" },
                ]}
                value={settings.source}
                disabled={locked}
                onChange={selectSource}
              />
            </Field>
            <Field label={settings.source === "screen" ? "Screen" : "Window"}>
              {settings.source === "screen" ? (
                <SourceSelect
                  sources={options.screens}
                  value={settings.screenId}
                  disabled={locked}
                  onChange={(screenId) => update({ screenId })}
                />
              ) : (
                <SourceSelect
                  sources={options.windows}
                  value={settings.windowId}
                  disabled={locked}
                  onChange={(windowId) => update({ windowId })}
                />
              )}
              <button type="button" className={secondaryButtonClass} disabled={locked} onClick={refreshSources}>
                Refresh
              </button>
            </Field>
          </>
        )}

        <Field label="FPS">
          <Segmented
            options={options.fpsOptions.map((fps) => ({ value: fps, label: String(fps) }))}
            value={settings.fps}
            disabled={locked}
            onChange={(fps) => update({ fps })}
          />
        </Field>

        <Field label="Audio">
          <select
            className={inputClass}
            value={settings.audio}
            disabled={locked}
            onChange={(e) => update({ audio: e.target.value })}
          >
            <option value="">No audio</option>
            {options.systemAudio && <option value="system">System audio</option>}
            {microphones.map((mic, i) => (
              <option key={mic.deviceId} value={mic.deviceId}>
                {mic.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Save to">
          <span className="min-w-0 flex-1 truncate text-sm" title={folder}>
            {folder}
          </span>
          <button type="button" className={secondaryButtonClass} disabled={locked} onClick={chooseFolder}>
            Browse...
          </button>
        </Field>
      </div>

      <div className="mt-8 mb-4 flex gap-3">
        <button
          type="button"
          disabled={busy || status.state === "starting" || status.state === "saving"}
          onClick={toggleRecording}
          className={`w-44 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
            status.state === "recording" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {recordLabel}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => call("openFolder").catch((err) => setError(errorMessage(err)))}
        >
          Open folder
        </button>
      </div>

      <StatusLine status={status} elapsed={elapsed} error={error ?? status.error} />
    </div>
  );
}
