import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { Host } from "../../host";
import { killTree, run, which } from "../../lib/process";
import type { Tool, ToolApi } from "../types";
import { installYtdlp, isInstalled, updateYtdlp, ytdlpPath, ytdlpVersion } from "./ytdlp";

const TOOL_ID = "video_downloader";
const INSPECT_TIMEOUT_MS = 90_000;
const MAX_JOBS_KEPT = 50;
const EMIT_INTERVAL_MS = 250;

export type VideoQuality = "best" | "1080" | "720" | "480";
export type AudioFormat = "mp3" | "m4a";

export interface Settings {
  mode: "video" | "audio";
  videoQuality: VideoQuality;
  audioFormat: AudioFormat;
  subtitles: boolean;
}

export interface MediaInfo {
  url: string;
  title: string;
  uploader: string | null;
  /** Seconds; null for playlists and live streams. */
  duration: number | null;
  thumbnail: string | null;
  isPlaylist: boolean;
  /** Number of videos in a playlist. */
  count: number | null;
  site: string | null;
}

export interface DownloadRequest {
  info: MediaInfo;
  settings: Settings;
  /** For playlists: download every video (otherwise only the one in the URL, if any). */
  wholePlaylist: boolean;
}

export interface Job {
  id: number;
  title: string;
  /** e.g. "Video · 1080p" or "Audio · MP3". */
  description: string;
  state: "queued" | "downloading" | "processing" | "done" | "error" | "canceled";
  /** Progress of the current file, 0-100. */
  percent: number | null;
  /** Bytes per second. */
  speed: number | null;
  /** Seconds left for the current file. */
  eta: number | null;
  /** Current item and number of items (1 and 1 for a single video). */
  item: number;
  items: number;
  /** Saved files. */
  files: string[];
  error: string | null;
}

export interface Options {
  ytdlp: { installed: boolean; version: string | null };
  settings: Settings;
  folder: string;
  jobs: Job[];
}

interface RunningJob {
  job: Job;
  request: DownloadRequest;
  folder: string;
  child?: ChildProcess;
}

const QUALITY_LABELS: Record<VideoQuality, string> = { best: "Best quality", 1080: "1080p", 720: "720p", 480: "480p" };

function describe(settings: Settings) {
  return settings.mode === "audio"
    ? `Audio · ${settings.audioFormat.toUpperCase()}`
    : `Video · ${QUALITY_LABELS[settings.videoQuality]}`;
}

/** yt-dlp's "ERROR: [site] id: message" lines, without the prefix. */
function errorLines(lines: string[]) {
  return lines.filter((line) => line.startsWith("ERROR:")).map((line) => line.replace(/^ERROR:\s*/, ""));
}

// Lines the app asks yt-dlp to print (see buildArgs), prefixed with @@ to tell
// them apart from its other output.
const START_LINE = /^@@start (\d+) (\d+) (.*)$/;
const PROGRESS_LINE = /^@@progress (\{.*\})$/;
const POSTPROCESS_LINE = /^@@post (\S+) started$/;
const DONE_LINE = /^@@done (.+)$/;

/**
 * Downloads videos and audio from the web with yt-dlp. Downloads run one at a
 * time from a queue; the UI follows them through "jobs" events.
 */
class VideoDownloaderApi implements ToolApi {
  private folder = app.getPath("downloads");
  private settings: Settings = { mode: "video", videoQuality: "best", audioFormat: "mp3", subtitles: false };
  private jobs: RunningJob[] = [];
  private nextId = 1;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly host: Host) {}

  async options(): Promise<Options> {
    return {
      ytdlp: { installed: isInstalled(), version: await ytdlpVersion() },
      settings: this.settings,
      folder: this.folder,
      jobs: this.jobList(),
    };
  }

  async installYtdlp() {
    await installYtdlp();
    return { installed: true, version: await ytdlpVersion() };
  }

  async updateYtdlp() {
    if (this.active()) throw new Error("Wait for the downloads to finish before updating yt-dlp.");
    const message = await updateYtdlp();
    return { version: await ytdlpVersion(), message };
  }

  /** Read the title, thumbnail, etc. of a URL without downloading it. */
  async inspect(url: string): Promise<MediaInfo> {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Enter a web address starting with http:// or https://.");
    const output = await run(ytdlpPath(), ["-J", "--flat-playlist", "--no-warnings", ...this.jsRuntimeArgs(), url], {
      timeout: INSPECT_TIMEOUT_MS,
      env: this.env(),
    }).catch((err: Error) => {
      throw new Error(errorLines(err.message.split(/\r?\n/)).join("\n") || err.message);
    });
    const data = JSON.parse(output);
    const isPlaylist = data._type === "playlist";
    return {
      url,
      title: data.title ?? url,
      uploader: data.uploader ?? data.channel ?? null,
      duration: typeof data.duration === "number" ? data.duration : null,
      thumbnail: data.thumbnail ?? data.thumbnails?.at(-1)?.url ?? null,
      isPlaylist,
      count: isPlaylist ? (data.playlist_count ?? data.entries?.length ?? null) : null,
      site: data.webpage_url_domain ?? data.extractor_key ?? null,
    };
  }

  async download(request: DownloadRequest) {
    this.settings = request.settings;
    const playlist = request.info.isPlaylist && request.wholePlaylist;
    const job: Job = {
      id: this.nextId++,
      title: request.info.title,
      description: describe(request.settings) + (playlist ? ` · ${request.info.count ?? "?"} videos` : ""),
      state: "queued",
      percent: null,
      speed: null,
      eta: null,
      item: 1,
      items: playlist ? (request.info.count ?? 1) : 1,
      files: [],
      error: null,
    };
    this.jobs.unshift({ job, request, folder: this.folder });
    this.jobs.splice(MAX_JOBS_KEPT);
    this.emit(true);
    this.startNext();
    return this.jobList();
  }

  cancel(id: number) {
    const entry = this.jobs.find((candidate) => candidate.job.id === id);
    if (!entry || !["queued", "downloading", "processing"].includes(entry.job.state)) return this.jobList();
    entry.job.state = "canceled";
    if (entry.child) killTree(entry.child);
    this.emit(true);
    return this.jobList();
  }

  /** Remove finished, failed and canceled downloads from the list. */
  clearFinished() {
    this.jobs = this.jobs.filter(({ job }) => ["queued", "downloading", "processing"].includes(job.state));
    this.emit(true);
    return this.jobList();
  }

  showFile(path: string) {
    this.host.showInFolder(path);
  }

  async chooseFolder() {
    const folder = await this.host.pickFolder(this.folder);
    if (folder) this.folder = folder;
    return this.folder;
  }

  openFolder() {
    return this.host.openPath(this.folder);
  }

  getJobs() {
    return this.jobList();
  }

  shutdown() {
    for (const entry of this.jobs) {
      if (entry.child) killTree(entry.child);
    }
  }

  // --- Internals ---

  private jobList() {
    return this.jobs.map(({ job }) => job);
  }

  private active() {
    return this.jobs.some(({ job }) => job.state === "downloading" || job.state === "processing");
  }

  /** Send the job list to the UI, at most every EMIT_INTERVAL_MS for progress updates. */
  private emit(now = false) {
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.host.emit(TOOL_ID, "jobs", this.jobList());
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => this.emit(true), EMIT_INTERVAL_MS);
    }
  }

  // yt-dlp needs a JavaScript runtime for YouTube. Node.js is always there,
  // since the app is started with npm.
  private jsRuntimeArgs() {
    const node = which("node");
    return node ? ["--js-runtimes", `node:${node}`] : [];
  }

  private env() {
    // Makes yt-dlp print titles with accents etc. correctly on Windows.
    return { ...process.env, PYTHONIOENCODING: "utf-8" };
  }

  private buildArgs({ request, folder }: RunningJob) {
    const { info, settings } = request;
    const playlist = info.isPlaylist && request.wholePlaylist;
    const args = [
      "--newline",
      "--progress",
      "--no-mtime",
      "--progress-template", "download:@@progress %(progress)j",
      "--progress-template", "postprocess:@@post %(progress.postprocessor)s %(progress.status)s",
      "--print", "before_dl:@@start %(playlist_index|0)s %(n_entries|1)s %(title)s",
      "--print", "after_move:@@done %(filepath)s",
      ...this.jsRuntimeArgs(),
      playlist ? "--yes-playlist" : "--no-playlist",
    ];
    if (ffmpegPath) args.push("--ffmpeg-location", ffmpegPath);
    // In a playlist, skip videos that fail instead of stopping.
    if (playlist) args.push("--ignore-errors");

    if (settings.mode === "audio") {
      args.push("-f", "ba/b", "-x", "--audio-format", settings.audioFormat, "--audio-quality", "0");
    } else {
      // Prefer MP4/M4A streams, which play everywhere, at the highest resolution allowed.
      const resolution = settings.videoQuality === "best" ? "res" : `res:${settings.videoQuality}`;
      args.push("-f", "bv*+ba/b", "-S", `${resolution},ext:mp4:m4a`, "--merge-output-format", "mp4");
      if (settings.subtitles) {
        const language = app.getLocale().split("-")[0];
        args.push("--write-subs", "--sub-langs", `${language}.*,en.*`, "--embed-subs");
      }
    }

    // Videos include their resolution, so downloading the same video in another
    // quality creates a new file instead of finding the old one and skipping.
    const name = settings.mode === "video" ? "%(title).150B [%(id)s] %(height)sp.%(ext)s" : "%(title).150B [%(id)s].%(ext)s";
    const template = playlist
      ? join(folder, "%(playlist_title|Playlist).100B", `%(playlist_index)03d - ${name}`)
      : join(folder, name);
    args.push("-o", template, info.url);
    return args;
  }

  private startNext() {
    if (this.active()) return;
    // The list is newest first, so the oldest queued job is the last one.
    const entry = this.jobs.findLast(({ job }) => job.state === "queued");
    if (entry) this.runJob(entry);
  }

  private async runJob(entry: RunningJob) {
    const { job } = entry;
    job.state = "downloading";
    this.emit(true);

    await mkdir(entry.folder, { recursive: true });
    const child = spawn(ytdlpPath(), this.buildArgs(entry), {
      windowsHide: true,
      env: this.env(),
      // Own process group on macOS/Linux, so killTree() also stops ffmpeg.
      detached: process.platform !== "win32",
    });
    entry.child = child;

    const log: string[] = [];
    const handleLine = (line: string) => {
      let match: RegExpExecArray | null;
      if ((match = START_LINE.exec(line))) {
        job.item = Math.max(1, Number(match[1]));
        job.items = Math.max(job.items, Number(match[2]));
        job.state = "downloading";
        job.percent = 0;
        this.emit(true);
      } else if ((match = PROGRESS_LINE.exec(line))) {
        const progress = JSON.parse(match[1]);
        const total = progress.total_bytes ?? progress.total_bytes_estimate;
        job.percent = total ? Math.min(100, (100 * progress.downloaded_bytes) / total) : null;
        job.speed = progress.speed ?? null;
        job.eta = progress.eta ?? null;
        this.emit();
      } else if ((match = POSTPROCESS_LINE.exec(line))) {
        // Merging video and audio, converting to MP3, embedding subtitles...
        if (match[1] !== "MoveFiles") {
          job.state = "processing";
          this.emit(true);
        }
      } else if ((match = DONE_LINE.exec(line))) {
        job.files.push(match[1]);
        this.emit(true);
      } else {
        log.push(line);
        log.splice(0, Math.max(0, log.length - 50));
      }
    };
    const readLines = (stream: NodeJS.ReadableStream | null) => {
      let buffer = "";
      stream?.on("data", (data: Buffer) => {
        buffer += data.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) handleLine(line);
      });
    };
    readLines(child.stdout);
    readLines(child.stderr);

    const code = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
      child.on("error", (err) => {
        log.push(`ERROR: ${err.message}`);
        resolve(null);
      });
    });

    entry.child = undefined;
    // Read through entry: cancel() may have changed the state while waiting.
    if (entry.job.state !== "canceled") {
      const errors = errorLines(log);
      if (code === 0) {
        job.state = "done";
      } else if (job.files.length > 0) {
        // Part of a playlist failed.
        job.state = "done";
        job.error = `Some videos could not be downloaded:\n${errors.join("\n")}`;
      } else {
        job.state = "error";
        job.error = errors.join("\n") || log.slice(-3).join("\n") || `yt-dlp exited with code ${code}.`;
      }
      job.percent = job.state === "done" ? 100 : job.percent;
    }
    job.speed = null;
    job.eta = null;
    this.emit(true);
    this.startNext();
  }
}

const tool: Tool = {
  name: "Video Downloader",
  description: "Download videos or just their audio from the web, with yt-dlp.",
  createApi: (host) => new VideoDownloaderApi(host),
};

export default tool;
