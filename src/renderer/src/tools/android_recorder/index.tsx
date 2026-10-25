import { useEffect, useState } from "react";
import { callTool, errorMessage } from "../../api";
import { RecordControls, SaveToField, useRecordingStatus, type RecordingStatus } from "../../components/recording";
import { Checkbox, Field, FieldHint, inputClass, Notice, secondaryButtonClass, Segmented } from "../../components/ui";
import type { Device, Options, Settings, Setup } from "../../../../main/tools/android_recorder";

const TOOL_ID = "android_recorder";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

const SIZE_OPTIONS = [
  { value: 0, label: "Original" },
  { value: 1920, label: "1080p" },
  { value: 1280, label: "720p" },
];

function deviceLabel(device: Device) {
  const name = device.model ?? device.serial;
  return device.state === "device" ? name : `${name} (${device.state})`;
}

function SetupHelp({ setup, onRecheck }: { setup: Setup; onRecheck: () => void }) {
  return (
    <Notice>
      <p className="font-medium">
        {setup.tooOld
          ? `scrcpy ${setup.version} is too old. Version ${setup.minVersion} or newer is needed.`
          : "This tool needs scrcpy, which was not found."}
      </p>
      <p className="mt-2">{setup.tooOld ? "Update it" : "Install it"} with:</p>
      {setup.installCommand && (
        <code className="mt-1 block rounded bg-amber-100 px-2 py-1 font-mono text-xs select-all dark:bg-amber-900">
          {setup.installCommand}
        </code>
      )}
      <p className="mt-2">
        Other options: <span className="select-all">{setup.docsUrl}</span>. After installing, close and reopen the
        terminal and this app if it is still not found.
      </p>
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={onRecheck}>
        Check again
      </button>
    </Notice>
  );
}

export default function AndroidRecorder() {
  const [options, setOptions] = useState<Options | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useRecordingStatus(TOOL_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(opts: Options) {
    setOptions(opts);
    setSettings(opts.settings);
    setFolder(opts.folder);
    setStatus(opts.status);
  }

  useEffect(() => {
    call<Options>("options")
      .then(apply)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const update = (changes: Partial<Settings>) => setSettings((current) => current && { ...current, ...changes });

  async function reload(method: "options" | "recheck") {
    setError(null);
    try {
      const opts = await call<Options>(method);
      // Keep the user's choices except the device, which may have changed.
      setOptions(opts);
      setSettings((current) => current && { ...current, serial: opts.settings.serial });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleRecording() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call<RecordingStatus>(status?.state === "recording" ? "stop" : "start", settings));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!options || !settings || !status) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>;
  }

  const { setup, devices } = options;
  const ready = setup.scrcpy !== null && !setup.tooOld;
  const locked = status.state !== "idle" || busy || !ready;
  const selected = devices.find((device) => device.serial === settings.serial);

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Android Recorder</h2>
      <p className="mt-1 mb-8 text-sm text-gray-500">
        Record the screen of an Android phone connected by USB, optionally with its audio (Android 11+). Uses{" "}
        <span className="font-medium">scrcpy</span>; nothing is installed on the phone.
      </p>

      {!ready && <SetupHelp setup={setup} onRecheck={() => reload("recheck")} />}

      <div className="flex flex-col gap-4">
        <Field label="Device">
          <select
            className={inputClass}
            value={settings.serial ?? ""}
            disabled={locked}
            onChange={(e) => update({ serial: e.target.value })}
          >
            {devices.length === 0 && <option value="">No device found</option>}
            {devices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {deviceLabel(device)}
              </option>
            ))}
          </select>
          <button type="button" className={secondaryButtonClass} disabled={locked} onClick={() => reload("options")}>
            Refresh
          </button>
        </Field>
        {ready && devices.length === 0 && (
          <FieldHint>
            Connect the phone with a data USB cable and enable USB debugging: Settings &gt; About phone &gt; tap
            "Build number" 7 times, then Settings &gt; System &gt; Developer options &gt; USB debugging. Accept the
            prompt on the phone, then click Refresh.
          </FieldHint>
        )}
        {selected?.state === "unauthorized" && (
          <FieldHint>Unlock the phone and accept the "Allow USB debugging?" prompt, then click Refresh.</FieldHint>
        )}

        <Field label="Resolution">
          <Segmented
            options={SIZE_OPTIONS}
            value={settings.maxSize}
            disabled={locked}
            onChange={(maxSize) => update({ maxSize })}
          />
        </Field>

        <Field label="Options">
          <div className="flex flex-col gap-2">
            <Checkbox
              label="Record the phone's audio (Android 11+)"
              checked={settings.audio}
              disabled={locked}
              onChange={(audio) => update({ audio })}
            />
            <Checkbox
              label="Show the phone screen on this computer while recording"
              checked={settings.mirror}
              disabled={locked}
              onChange={(mirror) => update({ mirror })}
            />
          </div>
        </Field>

        <SaveToField toolId={TOOL_ID} folder={folder} disabled={locked} onChange={setFolder} onError={setError} />
      </div>

      <RecordControls
        toolId={TOOL_ID}
        status={status}
        busy={busy}
        error={error}
        canStart={ready && selected?.state === "device"}
        onToggle={toggleRecording}
        onError={setError}
      />
    </div>
  );
}
