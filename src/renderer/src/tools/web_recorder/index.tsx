import { useEffect, useMemo, useRef, useState } from "react";
import { callTool, errorMessage, onToolEvent } from "../../api";
import { Checkbox, Field, FieldHint, secondaryButtonClass, Segmented } from "../../components/ui";
import type { Options, RunJob } from "../../../../main/tools/web_recorder";
// Plain data shared with the main process, so the UI checks the script the same way.
import {
  COMMANDS,
  parseScript,
  RESOLUTIONS,
  TARGET_HELP,
  type Pace,
  type RecorderSettings,
  type Resolution,
} from "../../../../main/tools/web_recorder/script";

const TOOL_ID = "web_recorder";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

const DRAFT_SAVE_DELAY = 500;

const RESOLUTION_OPTIONS = (Object.keys(RESOLUTIONS) as Resolution[]).map((value) => ({
  value,
  label: { "1280x720": "720p", "1920x1080": "1080p", "2560x1440": "1440p" }[value],
}));
const FPS_OPTIONS: { value: RecorderSettings["fps"]; label: string }[] = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];
const PACE_OPTIONS: { value: Pace; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** Text area with line numbers; lines with errors are red and the running line is highlighted. */
function ScriptEditor({
  value,
  errorLines,
  activeLine,
  disabled,
  onChange,
}: {
  value: string;
  errorLines: Set<number>;
  activeLine: number | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const lines = value.split("\n").length;

  // Keep the running line visible.
  useEffect(() => {
    const element = area.current;
    if (!element || activeLine === null) return;
    const lineHeight = element.scrollHeight / Math.max(lines, 1);
    const top = (activeLine - 1) * lineHeight;
    if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - lineHeight) {
      element.scrollTop = top - element.clientHeight / 3;
    }
  }, [activeLine, lines]);

  return (
    <div className="flex h-80 overflow-hidden rounded-md border border-gray-300 bg-white font-mono text-sm leading-6 dark:border-gray-700 dark:bg-gray-900">
      <div
        ref={gutter}
        aria-hidden
        className="shrink-0 overflow-hidden border-r border-gray-200 bg-gray-50 py-2 text-right text-xs leading-6 text-gray-400 select-none dark:border-gray-800 dark:bg-gray-950"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={`px-2 ${
              activeLine === i + 1
                ? "bg-blue-600 text-white"
                : errorLines.has(i + 1)
                  ? "bg-red-100 font-bold text-red-600 dark:bg-red-950 dark:text-red-400"
                  : ""
            }`}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={area}
        value={value}
        disabled={disabled}
        spellCheck={false}
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className="flex-1 resize-none bg-transparent px-3 py-2 outline-none disabled:opacity-70"
      />
    </div>
  );
}

function Help() {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-blue-600 select-none hover:underline">Script commands</summary>
      <div className="mt-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
        <table className="w-full text-left text-xs">
          <tbody>
            {COMMANDS.map((command) => (
              <tr key={command.syntax} className="align-top">
                <td className="py-1 pr-4 font-mono whitespace-nowrap">{command.syntax}</td>
                <td className="py-1 text-gray-600 dark:text-gray-400">{command.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">{TARGET_HELP}</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Lines starting with # are comments. Quote arguments that contain spaces, e.g.{" "}
          <code className="font-mono">click &quot;nav a.active&quot;</code>.
        </p>
      </div>
    </details>
  );
}

export default function WebRecorder() {
  const [script, setScript] = useState<string | null>(null);
  const [scriptPath, setScriptPath] = useState<string | null>(null);
  const [settings, setSettings] = useState<RecorderSettings | null>(null);
  const [folder, setFolder] = useState("");
  const [job, setJob] = useState<RunJob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    call<Options>("options")
      .then((opts) => {
        setScript(opts.script);
        setScriptPath(opts.scriptPath);
        setSettings(opts.settings);
        setFolder(opts.folder);
        setJob(opts.job);
      })
      .catch((err) => setError(errorMessage(err)));
    const offJob = onToolEvent(TOOL_ID, "job", (payload) => setJob(payload as RunJob));
    const offPreview = onToolEvent(TOOL_ID, "preview", (payload) => setPreview(payload as string));
    return () => {
      offJob();
      offPreview();
    };
  }, []);

  const parsed = useMemo(() => parseScript(script ?? ""), [script]);
  const errorLines = useMemo(() => new Set(parsed.errors.map((item) => item.line)), [parsed]);
  const firstUrl = parsed.steps.find((step) => step.command.kind === "goto")?.command;
  const loginUrl = firstUrl?.kind === "goto" ? firstUrl.url : null;

  function edit(value: string) {
    setScript(value);
    setEdited(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => call("setScript", value), DRAFT_SAVE_DELAY);
  }

  function updateSettings(changes: Partial<RecorderSettings>) {
    if (!settings) return;
    const next = { ...settings, ...changes };
    setSettings(next);
    call("setSettings", next);
  }

  async function attempt(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const openScript = () =>
    attempt(async () => {
      const result = await call<{ path: string; script: string } | null>("openScript");
      if (!result) return;
      setScript(result.script);
      setScriptPath(result.path);
      setEdited(false);
    });

  const saveScript = (saveAs: boolean) =>
    attempt(async () => {
      const path = await call<string | null>("saveScript", script, saveAs);
      if (!path) return;
      setScriptPath(path);
      setEdited(false);
    });

  const newScript = () =>
    attempt(async () => {
      setScript(await call<string>("newScript"));
      setScriptPath(null);
      setEdited(false);
    });

  const run = (record: boolean) =>
    attempt(async () => {
      setPreview(null);
      setJob(await call<RunJob>("run", script, settings, record));
    });

  if (script === null || !settings || !job) {
    return error ? (
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    ) : (
      <p className="text-gray-500">Loading...</p>
    );
  }

  const running = job.state === "running";
  const [width, height] = RESOLUTIONS[settings.resolution];

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold">Web Recorder</h2>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        Records a presentation of a web app: write the steps (open a page, click, type, scroll, show captions) and the
        tool plays them in a browser and saves what it shows as a video, with a mouse cursor and click effects.
      </p>

      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium" title={scriptPath ?? undefined}>
          {scriptPath ? fileName(scriptPath) : "Unsaved script"}
          {edited && scriptPath && <span className="text-gray-500"> (edited)</span>}
        </span>
        <button
          type="button"
          className="text-blue-600 hover:underline disabled:opacity-50"
          disabled={running}
          onClick={newScript}
        >
          New
        </button>
        <button
          type="button"
          className="text-blue-600 hover:underline disabled:opacity-50"
          disabled={running}
          onClick={openScript}
        >
          Open...
        </button>
        <button
          type="button"
          className="text-blue-600 hover:underline disabled:opacity-50"
          disabled={running}
          onClick={() => saveScript(false)}
        >
          Save
        </button>
        <button
          type="button"
          className="text-blue-600 hover:underline disabled:opacity-50"
          disabled={running}
          onClick={() => saveScript(true)}
        >
          Save as...
        </button>
      </div>
      <ScriptEditor
        value={script}
        errorLines={errorLines}
        activeLine={running || job.state === "error" ? job.line : null}
        disabled={running}
        onChange={edit}
      />
      {parsed.errors.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-red-600 dark:text-red-400">
          {parsed.errors.slice(0, 5).map((item) => (
            <li key={item.line}>
              Line {item.line}: {item.message}
            </li>
          ))}
          {parsed.errors.length > 5 && <li>... and {parsed.errors.length - 5} more.</li>}
        </ul>
      )}
      <Help />

      <div className="mt-6 flex flex-col gap-4">
        <Field label="Resolution">
          <Segmented
            options={RESOLUTION_OPTIONS}
            value={settings.resolution}
            disabled={running}
            onChange={(resolution) => updateSettings({ resolution })}
          />
          <span className="text-sm text-gray-500">
            {width}x{height}
          </span>
        </Field>
        <Field label="FPS">
          <Segmented
            options={FPS_OPTIONS}
            value={settings.fps}
            disabled={running}
            onChange={(fps) => updateSettings({ fps })}
          />
        </Field>
        <Field label="Pace">
          <Segmented
            options={PACE_OPTIONS}
            value={settings.pace}
            disabled={running}
            onChange={(pace) => updateSettings({ pace })}
          />
        </Field>
        <FieldHint>Speed of the cursor, typing and the pauses between steps.</FieldHint>
        <Field label="Cursor">
          <Checkbox
            label="Show the mouse cursor and click effects"
            checked={settings.cursor}
            disabled={running}
            onChange={(cursor) => updateSettings({ cursor })}
          />
        </Field>
        <Field label="Logins">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={!loginUrl}
            onClick={() => loginUrl && call("openLogin", loginUrl)}
          >
            Log in...
          </button>
          <button
            type="button"
            className="text-sm text-gray-500 hover:underline disabled:opacity-50"
            disabled={running}
            onClick={() =>
              attempt(async () => {
                await call("clearLogins");
                setNotice("Logins and site data were cleared.");
              })
            }
          >
            Clear saved logins
          </button>
        </Field>
        <FieldHint>
          {loginUrl
            ? `Opens ${new URL(loginUrl).host} in a window: log in, then close it. Recordings use the same browser, so they start logged in.`
            : "Add a goto line to the script to log in to that site."}
        </FieldHint>
        <Field label="Save to">
          <span className="min-w-0 flex-1 truncate text-sm" title={folder}>
            {folder}
          </span>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={running}
            onClick={() => call<string>("chooseFolder").then(setFolder)}
          >
            Browse...
          </button>
        </Field>
      </div>

      <div className="mt-8 mb-4 flex items-center gap-3">
        {running ? (
          <button type="button" className={`${secondaryButtonClass} w-44`} onClick={() => call("cancel")}>
            {job.recording ? "Stop" : "Stop test"}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={parsed.errors.length > 0}
              onClick={() => run(true)}
              className="w-44 rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Record
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={parsed.errors.length > 0}
              onClick={() => run(false)}
            >
              Test run
            </button>
          </>
        )}
        {running && (
          <div className="min-w-0 flex-1">
            <p className="mb-1 truncate text-xs text-gray-500">
              {job.recording ? "Recording" : "Testing"} · step {job.step + 1} of {job.total}
              {job.line !== null && ` · line ${job.line}: ${job.source}`}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full bg-blue-600 transition-[width]"
                style={{ width: `${(100 * job.step) / Math.max(job.total, 1)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {!running && (
        <p className="-mt-2 mb-4 text-xs text-gray-500">
          Test run plays the script without saving a video, to check it.
        </p>
      )}

      {preview && (
        <img
          src={preview}
          alt="What the browser shows"
          className="mb-4 w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      )}

      {job.state === "done" && job.output && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Saved {fileName(job.output)} ({formatDuration(job.duration)}
          {job.outputSize !== null && `, ${formatBytes(job.outputSize)}`}){" · "}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => call("openFile", job.output)}>
            Play
          </button>
          {" · "}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => call("showFile", job.output)}>
            Show in folder
          </button>
        </p>
      )}
      {job.state === "done" && !job.recording && (
        <p className="text-sm text-gray-600 dark:text-gray-400">Test run finished without errors.</p>
      )}
      {job.state === "canceled" && (
        <p className="text-sm text-gray-500">
          {job.recording ? "Recording stopped; nothing was saved." : "Test stopped."}
        </p>
      )}
      {notice && <p className="text-sm text-gray-600 dark:text-gray-400">{notice}</p>}
      {(error ?? (job.state === "error" ? job.error : null)) && (
        <p className="mt-2 text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">{error ?? job.error}</p>
      )}
    </div>
  );
}
