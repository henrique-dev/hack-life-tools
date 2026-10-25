import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { callTool, errorMessage, getPathForFile, onToolEvent } from "../../api";
import { Checkbox, Field, FieldHint, inputBaseClass, secondaryButtonClass, Segmented } from "../../components/ui";
import type {
  Compression,
  ExportJob,
  ExportSettings,
  LoadedFile,
  Options,
} from "../../../../main/tools/video_editor";

const TOOL_ID = "video_editor";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

const COMPRESSION_OPTIONS: { value: Compression; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "strong", label: "Strong" },
  { value: "target", label: "Target size" },
];
const COMPRESSION_HINTS: Record<Compression, string> = {
  none: "Fastest and no quality loss, but cuts snap to the nearest keyframe and may be off by a few seconds.",
  light: "Re-encodes with high quality. Usually a moderate size reduction.",
  medium: "Good balance between quality and size.",
  strong: "Smallest files; quality loss is visible.",
  target: "Aims for the file size you choose (e.g. to fit a message or upload limit). Takes two passes.",
};
const SIZE_OPTIONS: { value: ExportSettings["maxSize"]; label: string }[] = [
  { value: 0, label: "Original" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
];

function formatTime(seconds: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${pad(m)}:${s}` : `${m}:${s}`;
}

/** Parse "75", "1:15", "1:15.5" or "0:01:15". Returns null if invalid. */
function parseTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function TimeInput({ value, max, disabled, onChange }: { value: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);

  function commit() {
    const parsed = parseTime(text);
    if (parsed === null) setText(formatTime(value));
    else onChange(Math.min(max, parsed));
  }

  return (
    <input
      className={`${inputBaseClass} w-28 font-mono`}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && commit()}
    />
  );
}

/** Bar showing the whole file, the selected part and the playhead. */
function Timeline({ duration, start, end, current }: { duration: number; start: number; end: number; current: number }) {
  const percent = (value: number) => `${(100 * value) / duration}%`;
  return (
    <div className="relative mt-3 h-2 rounded-full bg-gray-200 dark:bg-gray-800">
      <div className="absolute inset-y-0 rounded-full bg-blue-500" style={{ left: percent(start), width: percent(end - start) }} />
      <div className="absolute -inset-y-1 w-0.5 bg-gray-900 dark:bg-white" style={{ left: percent(current) }} />
    </div>
  );
}

function DropZone({ onOpen, onDropPath, loading }: { onOpen: () => void; onDropPath: (path: string) => void; loading: boolean }) {
  const [over, setOver] = useState(false);
  function drop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onDropPath(getPathForFile(file));
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center ${
        over ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-gray-300 dark:border-gray-700"
      }`}
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">{loading ? "Reading the file..." : "Drop a video or audio file here"}</p>
      <button type="button" className={secondaryButtonClass} disabled={loading} onClick={onOpen}>
        Open file...
      </button>
    </div>
  );
}

export default function VideoEditor() {
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  // Set while "Play selection" is playing, to pause at the end of the selection.
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    call<Options>("options")
      .then((opts) => {
        setSettings(opts.settings);
        setFolder(opts.folder);
        setJob(opts.job);
      })
      .catch((err) => setError(errorMessage(err)));
    return onToolEvent(TOOL_ID, "job", (payload) => setJob(payload as ExportJob));
  }, []);

  const update = (changes: Partial<ExportSettings>) => setSettings((current) => current && { ...current, ...changes });

  function show(loaded: LoadedFile | null) {
    if (!loaded) return;
    setFile(loaded);
    setStart(0);
    setEnd(loaded.duration);
    setCurrent(0);
    // Files without video can only be exported as audio.
    if (!loaded.video) update({ output: "audio" });
  }

  async function open(method: "openFile" | "load", ...args: unknown[]) {
    setLoading(true);
    setError(null);
    try {
      show(await call<LoadedFile | null>(method, ...args));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function playSelection() {
    const video = player.current;
    if (!video) return;
    video.currentTime = start;
    stopAt.current = end;
    video.play();
  }

  function onTimeUpdate() {
    const video = player.current;
    if (!video) return;
    setCurrent(video.currentTime);
    if (stopAt.current !== null && video.currentTime >= stopAt.current) {
      video.pause();
      stopAt.current = null;
    }
  }

  async function exportFile() {
    if (!file || !settings) return;
    setError(null);
    try {
      setJob(await call<ExportJob>("export", { path: file.path, start, end, settings }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!settings || !job) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>;
  }

  const running = job.state === "running";
  const length = end - start;
  const details = file && [
    formatTime(file.duration),
    file.video && `${file.video.width}x${file.video.height} ${file.video.codec}`,
    file.audio ? `audio ${file.audio.codec}` : "no audio",
    formatBytes(file.size),
  ].filter(Boolean).join(" · ");

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Video Editor</h2>
      <p className="mt-1 mb-8 text-sm text-gray-500">
        Trim a video, remove its audio or keep only the audio, and compress it to make the file smaller. The
        original file is never changed.
      </p>

      {!file ? (
        <DropZone onOpen={() => open("openFile")} onDropPath={(path) => open("load", path)} loading={loading} />
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium" title={file.path}>{file.name}</p>
            <button type="button" className="shrink-0 text-sm text-blue-600 hover:underline disabled:opacity-50" disabled={running} onClick={() => open("openFile")}>
              Open another file
            </button>
          </div>
          {file.video ? (
            <video
              ref={player}
              src={file.previewUrl}
              controls
              className="max-h-80 w-full rounded-md bg-black"
              onTimeUpdate={onTimeUpdate}
              onSeeked={onTimeUpdate}
            />
          ) : (
            <audio ref={player as never} src={file.previewUrl} controls className="w-full" onTimeUpdate={onTimeUpdate} />
          )}
          <p className="mt-1 text-xs text-gray-500">{details}</p>
          <Timeline duration={file.duration} start={start} end={end} current={current} />

          <div className="mt-6 flex flex-col gap-4">
            <Field label="Start">
              <TimeInput value={start} max={end - 0.1} disabled={running} onChange={setStart} />
              <button type="button" className={secondaryButtonClass} disabled={running || current >= end} onClick={() => setStart(current)}>
                Set to current
              </button>
            </Field>
            <Field label="End">
              <TimeInput value={end} max={file.duration} disabled={running} onChange={(value) => setEnd(Math.max(start + 0.1, value))} />
              <button type="button" className={secondaryButtonClass} disabled={running || current <= start} onClick={() => setEnd(current)}>
                Set to current
              </button>
            </Field>
            <FieldHint>
              Selection: {formatTime(length)}
              {(start > 0 || end < file.duration) && (
                <>
                  {" · "}
                  <button type="button" className="text-blue-600 hover:underline" onClick={playSelection}>Play selection</button>
                  {" · "}
                  <button type="button" className="text-blue-600 hover:underline" disabled={running} onClick={() => { setStart(0); setEnd(file.duration); }}>
                    Reset
                  </button>
                </>
              )}
            </FieldHint>

            <Field label="Output">
              <Segmented
                options={[
                  { value: "video", label: "Video" },
                  { value: "audio", label: "Audio only" },
                ].filter((option) => (option.value === "video" ? file.video : file.audio))}
                value={settings.output}
                disabled={running}
                onChange={(output) => update({ output: output as ExportSettings["output"] })}
              />
            </Field>

            {settings.output === "video" ? (
              <>
                <Field label="Audio">
                  <Checkbox
                    label={file.audio ? "Remove the audio" : "This file has no audio"}
                    checked={settings.removeAudio || !file.audio}
                    disabled={running || !file.audio}
                    onChange={(removeAudio) => update({ removeAudio })}
                  />
                </Field>
                <Field label="Compress">
                  <Segmented options={COMPRESSION_OPTIONS} value={settings.compression} disabled={running} onChange={(compression) => update({ compression })} />
                </Field>
                {settings.compression === "target" && (
                  <Field label="Target size">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={`${inputBaseClass} w-28`}
                      value={settings.targetSizeMb}
                      disabled={running}
                      onChange={(e) => update({ targetSizeMb: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <span className="text-sm text-gray-500">MB</span>
                  </Field>
                )}
                <FieldHint>{COMPRESSION_HINTS[settings.compression]}</FieldHint>
                <Field label="Resolution">
                  <Segmented options={SIZE_OPTIONS} value={settings.maxSize} disabled={running} onChange={(maxSize) => update({ maxSize })} />
                </Field>
              </>
            ) : (
              <Field label="Format">
                <Segmented
                  options={[
                    { value: "mp3", label: "MP3" },
                    { value: "m4a", label: "M4A" },
                  ]}
                  value={settings.audioFormat}
                  disabled={running}
                  onChange={(audioFormat) => update({ audioFormat: audioFormat as ExportSettings["audioFormat"] })}
                />
              </Field>
            )}

            <Field label="Save to">
              <span className="min-w-0 flex-1 truncate text-sm" title={folder ?? undefined}>
                {folder ?? "Next to the original file"}
              </span>
              {folder && (
                <button type="button" className="text-sm text-gray-500 hover:underline" disabled={running} onClick={() => call<null>("resetFolder").then(setFolder)}>
                  Reset
                </button>
              )}
              <button type="button" className={secondaryButtonClass} disabled={running} onClick={() => call<string | null>("chooseFolder").then(setFolder)}>
                Browse...
              </button>
            </Field>
          </div>

          <div className="mt-8 mb-4 flex items-center gap-3">
            {running ? (
              <button type="button" className={`${secondaryButtonClass} w-44`} onClick={() => call("cancel")}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={exportFile}
                className="w-44 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Export
              </button>
            )}
            {running && (
              <div className="flex-1">
                <p className="mb-1 text-xs text-gray-500">
                  {job.step ? `${job.step} · ` : ""}
                  {job.percent.toFixed(0)}%
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${job.percent}%` }} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {job.state === "done" && job.output && job.outputSize !== null && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Saved {job.output.split(/[\\/]/).at(-1)} ({formatBytes(job.outputSize)}
          {job.inputSize > 0 && job.outputSize < job.inputSize && `, ${Math.round(100 - (100 * job.outputSize) / job.inputSize)}% smaller than the original`}
          ){" · "}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => call("showFile", job.output)}>
            Show in folder
          </button>
        </p>
      )}
      {job.state === "canceled" && <p className="text-sm text-gray-500">Export canceled.</p>}
      {(error ?? job.error) && <p className="mt-2 text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">{error ?? job.error}</p>}
    </div>
  );
}
