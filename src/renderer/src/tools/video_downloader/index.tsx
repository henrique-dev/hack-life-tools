import { useEffect, useState, type FormEvent } from "react";
import { callTool, errorMessage, onToolEvent } from "../../api";
import { SaveToField } from "../../components/recording";
import { Checkbox, Field, inputBaseClass, Notice, secondaryButtonClass, Segmented } from "../../components/ui";
import type {
  AudioFormat,
  Job,
  MediaInfo,
  Options,
  Settings,
  VideoQuality,
} from "../../../../main/tools/video_downloader";

const TOOL_ID = "video_downloader";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

const QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: "best", label: "Best" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];
const AUDIO_OPTIONS: { value: AudioFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
];
const ACTIVE_STATES: Job["state"][] = ["queued", "downloading", "processing"];

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

function formatSpeed(bytesPerSecond: number) {
  const mb = bytesPerSecond / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1000)} KB/s`;
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function SetupYtdlp({ onInstalled }: { onInstalled: (version: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setBusy(true);
    setError(null);
    try {
      const result = await call<{ version: string | null }>("installYtdlp");
      onInstalled(result.version);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Notice>
      <p className="font-medium">This tool uses yt-dlp, which is not downloaded yet.</p>
      <p className="mt-2">
        It will be downloaded from its official GitHub releases (about 20 MB), checked against the published
        checksum and kept in this app's data folder.
      </p>
      <button type="button" className={`${secondaryButtonClass} mt-3`} disabled={busy} onClick={install}>
        {busy ? "Downloading..." : "Download yt-dlp"}
      </button>
      {error && <p className="mt-2 whitespace-pre-wrap text-red-700 dark:text-red-300">{error}</p>}
    </Notice>
  );
}

function Preview({ info }: { info: MediaInfo }) {
  const details = [
    info.site,
    info.uploader,
    info.isPlaylist ? `Playlist · ${info.count ?? "?"} videos` : null,
    info.duration != null ? formatDuration(info.duration) : null,
  ].filter(Boolean);
  return (
    <div className="flex gap-4 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      {info.thumbnail && (
        <img src={info.thumbnail} alt="" className="h-20 w-36 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />
      )}
      <div className="min-w-0">
        <p className="line-clamp-2 font-medium">{info.title}</p>
        <p className="mt-1 text-sm text-gray-500">{details.join(" · ")}</p>
      </div>
    </div>
  );
}

function JobRow({ job, onCancel, onShow }: { job: Job; onCancel: () => void; onShow: (path: string) => void }) {
  const active = ACTIVE_STATES.includes(job.state);
  const item = job.items > 1 ? `Video ${job.item} of ${job.items} · ` : "";
  let detail: string;
  if (job.state === "queued") detail = "Waiting...";
  else if (job.state === "processing") detail = `${item}Processing...`;
  else if (job.state === "downloading") {
    const parts = [
      job.percent != null ? `${job.percent.toFixed(0)}%` : "Downloading...",
      job.speed ? formatSpeed(job.speed) : null,
      job.eta != null ? `${formatDuration(job.eta)} left` : null,
    ].filter(Boolean);
    detail = item + parts.join(" · ");
  } else if (job.state === "done") detail = job.files.length === 1 ? fileName(job.files[0]) : `${job.files.length} files`;
  else if (job.state === "canceled") detail = "Canceled";
  else detail = "Failed";

  return (
    <li className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={job.title}>
            {job.title}
          </p>
          <p className="text-xs text-gray-500">
            {job.description} · {detail}
          </p>
        </div>
        {active && (
          <button type="button" className="text-sm text-gray-500 hover:text-red-600" onClick={onCancel}>
            Cancel
          </button>
        )}
        {job.state === "done" && job.files.length > 0 && (
          <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => onShow(job.files[0])}>
            Show in folder
          </button>
        )}
      </div>
      {(job.state === "downloading" || job.state === "processing") && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            className={`h-full bg-blue-600 transition-[width] ${job.state === "processing" ? "w-full animate-pulse" : ""}`}
            style={job.state === "downloading" ? { width: `${job.percent ?? 0}%` } : undefined}
          />
        </div>
      )}
      {job.error && <p className="mt-2 text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{job.error}</p>}
    </li>
  );
}

export default function VideoDownloader() {
  const [options, setOptions] = useState<Options | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [wholePlaylist, setWholePlaylist] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Options>("options")
      .then((opts) => {
        setOptions(opts);
        setSettings(opts.settings);
        setFolder(opts.folder);
        setJobs(opts.jobs);
      })
      .catch((err) => setError(errorMessage(err)));
    return onToolEvent(TOOL_ID, "jobs", (payload) => setJobs(payload as Job[]));
  }, []);

  const update = (changes: Partial<Settings>) => setSettings((current) => current && { ...current, ...changes });

  async function inspect(event?: FormEvent) {
    event?.preventDefault();
    if (!url.trim()) return;
    setChecking(true);
    setError(null);
    setInfo(null);
    try {
      const result = await call<MediaInfo>("inspect", url);
      setInfo(result);
      setWholePlaylist(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function download() {
    if (!info || !settings) return;
    setError(null);
    try {
      setJobs(await call<Job[]>("download", { info, settings, wholePlaylist }));
      setInfo(null);
      setUrl("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function updateYtdlp() {
    setUpdating(true);
    setMessage(null);
    setError(null);
    try {
      const result = await call<{ version: string | null; message: string }>("updateYtdlp");
      setOptions((current) => current && { ...current, ytdlp: { installed: true, version: result.version } });
      setMessage(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUpdating(false);
    }
  }

  if (!options || !settings) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>;
  }

  const installed = options.ytdlp.installed;
  const hasFinished = jobs.some((job) => !ACTIVE_STATES.includes(job.state));

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Video Downloader</h2>
      <p className="mt-1 mb-2 text-sm text-gray-500">
        Download videos or just their audio from YouTube and thousands of other sites, using yt-dlp.
      </p>
      <p className="mb-8 text-xs text-gray-500">
        Only download content you have the right to save. DRM-protected services (Netflix, Spotify, ...) are not
        supported.
      </p>

      {!installed ? (
        <SetupYtdlp
          onInstalled={(version) =>
            setOptions((current) => current && { ...current, ytdlp: { installed: true, version } })
          }
        />
      ) : (
        <>
          <form className="mb-4 flex gap-3" onSubmit={inspect}>
            <input
              type="url"
              className={`${inputBaseClass} flex-1`}
              placeholder="Paste a video or playlist URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" className={secondaryButtonClass} disabled={checking || !url.trim()}>
              {checking ? "Checking..." : "Check"}
            </button>
          </form>

          {info && (
            <div className="mb-6">
              <Preview info={info} />
            </div>
          )}

          <div className="flex flex-col gap-4">
            <Field label="Download">
              <Segmented
                options={[
                  { value: "video", label: "Video" },
                  { value: "audio", label: "Audio only" },
                ]}
                value={settings.mode}
                disabled={false}
                onChange={(mode) => update({ mode })}
              />
            </Field>

            {settings.mode === "video" ? (
              <>
                <Field label="Quality">
                  <Segmented
                    options={QUALITY_OPTIONS}
                    value={settings.videoQuality}
                    disabled={false}
                    onChange={(videoQuality) => update({ videoQuality })}
                  />
                </Field>
                <Field label="Subtitles">
                  <Checkbox
                    label="Include subtitles when available"
                    checked={settings.subtitles}
                    disabled={false}
                    onChange={(subtitles) => update({ subtitles })}
                  />
                </Field>
              </>
            ) : (
              <Field label="Format">
                <Segmented
                  options={AUDIO_OPTIONS}
                  value={settings.audioFormat}
                  disabled={false}
                  onChange={(audioFormat) => update({ audioFormat })}
                />
              </Field>
            )}

            {info?.isPlaylist && (
              <Field label="Playlist">
                <Checkbox
                  label={`Download all ${info.count ?? ""} videos`}
                  checked={wholePlaylist}
                  disabled={false}
                  onChange={setWholePlaylist}
                />
              </Field>
            )}

            <SaveToField toolId={TOOL_ID} folder={folder} disabled={false} onChange={setFolder} onError={setError} />
          </div>

          <div className="mt-8 mb-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!info}
              onClick={download}
              className="w-44 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Download
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => call("openFolder").catch((err) => setError(errorMessage(err)))}
            >
              Open folder
            </button>
            {!info && <span className="text-xs text-gray-500">Check a URL first.</span>}
          </div>
          {error && <p className="mb-4 text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">{error}</p>}

          {jobs.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Downloads</h3>
                {hasFinished && (
                  <button
                    type="button"
                    className="text-sm text-gray-500 hover:underline"
                    onClick={() => call<Job[]>("clearFinished").then(setJobs)}
                  >
                    Clear finished
                  </button>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onCancel={() => call<Job[]>("cancel", job.id).then(setJobs)}
                    onShow={(path) => call("showFile", path)}
                  />
                ))}
              </ul>
            </section>
          )}

          <p className="mt-10 text-xs text-gray-500">
            yt-dlp {options.ytdlp.version ?? "?"} ·{" "}
            <button type="button" className="hover:underline disabled:opacity-60" disabled={updating} onClick={updateYtdlp}>
              {updating ? "Updating..." : "Update"}
            </button>{" "}
            — sites change often; if a download that used to work fails, update yt-dlp.
            {message && <span className="block">{message}</span>}
          </p>
        </>
      )}
    </div>
  );
}
