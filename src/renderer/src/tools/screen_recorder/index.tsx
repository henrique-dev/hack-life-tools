import { useEffect, useState } from "react";
import { errorMessage } from "../../api";
import { RecordControls, SaveToField, useRecordingStatus } from "../../components/recording";
import { Field, FieldHint, inputClass, Notice, secondaryButtonClass, Segmented } from "../../components/ui";
import { call, TOOL_ID, type Options, type Settings, type Source, type Status } from "./shared";

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

export default function ScreenRecorder() {
  const [options, setOptions] = useState<Options | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [status, setStatus] = useRecordingStatus(TOOL_ID);
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

  if (!options || !settings || !status) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>;
  }

  const locked = status.state !== "idle" || busy;

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Screen Recorder</h2>
      <p className="mt-1 mb-8 text-sm text-gray-500">
        Record a screen or a single window, optionally with audio. While recording, this window is minimized and a
        floating timer with a stop button is shown; it does not appear in the video.
      </p>

      {options.warning && <Notice>{options.warning}</Notice>}

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
            {settings.source === "window" && (
              // Chromium cannot capture minimized windows, so it leaves them out of the list.
              <FieldHint>Minimized windows are not listed. Restore the window, then click Refresh.</FieldHint>
            )}
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

        <SaveToField toolId={TOOL_ID} folder={folder} disabled={locked} onChange={setFolder} onError={setError} />
      </div>

      <RecordControls
        toolId={TOOL_ID}
        status={status}
        busy={busy}
        error={error}
        onToggle={toggleRecording}
        onError={setError}
      />
    </div>
  );
}
