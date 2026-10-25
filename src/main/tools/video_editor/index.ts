import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, parse } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { Host } from "../../host";
import { killTree } from "../../lib/process";
import type { Tool, ToolApi } from "../types";
import { probe, type MediaInfo } from "./probe";

const TOOL_ID = "video_editor";
const MIN_LENGTH = 0.1;
// Share of the target size reserved for the container, so the result stays under it.
const TARGET_SIZE_MARGIN = 0.96;
const MIN_VIDEO_KBPS = 50;

const MEDIA_EXTENSIONS = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

/** H.264 quality (CRF: lower is better and bigger) and audio bitrate for each compression level. */
const COMPRESSION = {
  light: { crf: 23, audioKbps: 128 },
  medium: { crf: 28, audioKbps: 128 },
  strong: { crf: 33, audioKbps: 96 },
} as const;
const TARGET_AUDIO_KBPS = 128;

export type Compression = "none" | keyof typeof COMPRESSION | "target";

export interface ExportSettings {
  output: "video" | "audio";
  removeAudio: boolean;
  compression: Compression;
  /** For compression "target". */
  targetSizeMb: number;
  /** Shorter side of the video in pixels; 0 keeps the original size. */
  maxSize: 0 | 1080 | 720 | 480;
  audioFormat: "mp3" | "m4a";
}

export interface ExportRequest {
  path: string;
  /** Seconds. */
  start: number;
  end: number;
  settings: ExportSettings;
}

export interface ExportJob {
  state: "idle" | "running" | "done" | "error" | "canceled";
  /** e.g. "Pass 1 of 2" for target-size compression. */
  step: string | null;
  percent: number;
  output: string | null;
  inputSize: number;
  outputSize: number | null;
  error: string | null;
}

export interface LoadedFile extends MediaInfo {
  /** URL to play the file in the UI. */
  previewUrl: string;
}

export interface Options {
  settings: ExportSettings;
  /** null: save next to the original. */
  folder: string | null;
  job: ExportJob;
}

const idleJob = (): ExportJob => ({
  state: "idle", step: null, percent: 0, output: null, inputSize: 0, outputSize: null, error: null,
});

function seconds(value: number) {
  return value.toFixed(3);
}

function uniquePath(dir: string, base: string, extension: string) {
  let candidate = join(dir, `${base}.${extension}`);
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base} (${i}).${extension}`);
  return candidate;
}

/**
 * Scale so the shorter side is at most maxSize (0: keep the size), with even
 * dimensions as H.264 requires. Quotes keep the commas inside each expression.
 */
function scaleFilter(maxSize: number) {
  if (!maxSize) return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const limit = (side: string) => `trunc(min(${side},${maxSize})/2)*2`;
  return `scale='if(gte(iw,ih),-2,${limit("iw")})':'if(gte(iw,ih),${limit("ih")},-2)'`;
}

interface Pass {
  args: string[];
  step: string | null;
  /** Share of the total progress this pass covers, and where it starts. */
  weight: number;
  offset: number;
}

/**
 * Trims, removes audio or video, and compresses files with ffmpeg. The
 * original is never changed: the result is saved as a new file.
 */
class VideoEditorApi implements ToolApi {
  private settings: ExportSettings = {
    output: "video", removeAudio: false, compression: "none", targetSizeMb: 25, maxSize: 0, audioFormat: "mp3",
  };
  private folder: string | null = null;
  private job: ExportJob = idleJob();
  private child: ChildProcess | null = null;
  private canceled = false;
  /** Removes temporary files of the running export (two-pass logs). */
  private cleanupAfter: (() => Promise<void>) | null = null;

  constructor(private readonly host: Host) {}

  options(): Options {
    return { settings: this.settings, folder: this.folder, job: this.job };
  }

  async openFile(): Promise<LoadedFile | null> {
    const path = await this.host.pickFile([
      { name: "Video and audio", extensions: MEDIA_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ]);
    return path ? this.load(path) : null;
  }

  /** Read a file chosen by the user (also used for files dropped on the window). */
  async load(path: string): Promise<LoadedFile> {
    const info = await probe(path);
    return { ...info, previewUrl: this.host.mediaUrl(path) };
  }

  async chooseFolder() {
    const folder = await this.host.pickFolder(this.folder ?? "");
    if (folder) this.folder = folder;
    return this.folder;
  }

  /** Save next to the original again. */
  resetFolder() {
    this.folder = null;
    return this.folder;
  }

  showFile(path: string) {
    this.host.showInFolder(path);
  }

  getJob() {
    return this.job;
  }

  async export(request: ExportRequest) {
    if (this.job.state === "running") throw new Error("An export is already running.");
    if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform.");
    this.settings = request.settings;

    const info = await probe(request.path);
    const { settings } = request;
    const start = Math.max(0, request.start);
    const end = Math.min(info.duration, request.end);
    const length = end - start;
    if (length < MIN_LENGTH) throw new Error("The selection is too short.");
    if (settings.output === "audio" && !info.audio) throw new Error("This file has no audio.");
    if (settings.output === "video" && !info.video) throw new Error("This file has no video. Choose \"Audio only\".");

    const { name } = parse(request.path);
    const folder = this.folder ?? dirname(request.path);
    let output: string;
    let passes: Pass[];
    const input = ["-ss", seconds(start), "-i", request.path, "-t", seconds(length)];

    if (settings.output === "audio") {
      output = uniquePath(folder, name, settings.audioFormat);
      const codec = settings.audioFormat === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "aac", "-b:a", "192k"];
      passes = [{ args: [...input, "-vn", "-sn", "-dn", ...codec, output], step: null, weight: 1, offset: 0 }];
    } else if (settings.compression === "none" && !settings.maxSize) {
      // Copy the streams without re-encoding: fast and lossless, but the cut
      // snaps to the nearest keyframe. Keep the container so every codec fits.
      output = uniquePath(folder, `${name}_edited`, extname(request.path).slice(1) || "mp4");
      const audio = settings.removeAudio ? ["-an"] : [];
      passes = [{
        args: [...input, "-c", "copy", ...audio, "-sn", "-dn", "-avoid_negative_ts", "make_zero", output],
        step: null, weight: 1, offset: 0,
      }];
    } else {
      output = uniquePath(folder, `${name}_edited`, "mp4");
      const video = ["-vf", scaleFilter(settings.maxSize), "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"];
      const keepAudio = !settings.removeAudio && info.audio;
      const mp4 = ["-sn", "-dn", "-movflags", "+faststart", output];

      if (settings.compression === "target") {
        // Two passes: the first analyzes the video so the second can hit the
        // target size closely.
        const audioKbps = keepAudio ? TARGET_AUDIO_KBPS : 0;
        const totalKbps = (settings.targetSizeMb * 1024 * 1024 * 8 * TARGET_SIZE_MARGIN) / 1000 / length;
        const videoKbps = Math.floor(totalKbps - audioKbps);
        if (videoKbps < MIN_VIDEO_KBPS) {
          const minimum = Math.ceil((((MIN_VIDEO_KBPS + audioKbps) * 1000 * length) / 8 / TARGET_SIZE_MARGIN / 1024 / 1024) * 10) / 10;
          throw new Error(`${settings.targetSizeMb} MB is too small for ${Math.round(length)} seconds. Use at least ${minimum} MB or a shorter selection.`);
        }
        const passLog = join(tmpdir(), `hack-life-tools-${process.pid}-${Date.now()}`);
        const bitrate = ["-b:v", `${videoKbps}k`, "-passlogfile", passLog];
        const audio = keepAudio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`] : ["-an"];
        const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";
        passes = [
          { args: [...input, ...video, ...bitrate, "-pass", "1", "-an", "-f", "null", nullOutput], step: "Pass 1 of 2", weight: 0.5, offset: 0 },
          { args: [...input, ...video, ...bitrate, "-pass", "2", ...audio, ...mp4], step: "Pass 2 of 2", weight: 0.5, offset: 0.5 },
        ];
        this.cleanupAfter = () => this.removePassLogs(passLog);
      } else {
        const level = COMPRESSION[settings.compression === "none" ? "light" : settings.compression];
        // "none" only reaches here when resizing: keep quality high.
        const crf = settings.compression === "none" ? 20 : level.crf;
        const audio = keepAudio ? ["-c:a", "aac", "-b:a", `${level.audioKbps}k`] : ["-an"];
        passes = [{ args: [...input, ...video, "-crf", String(crf), ...audio, ...mp4], step: null, weight: 1, offset: 0 }];
      }
    }

    this.job = { ...idleJob(), state: "running", inputSize: info.size, output, step: passes[0].step };
    this.canceled = false;
    this.emit();
    this.runPasses(passes, length, output);
    return this.job;
  }

  cancel() {
    if (this.job.state !== "running") return this.job;
    this.canceled = true;
    if (this.child) killTree(this.child);
    return this.job;
  }

  shutdown() {
    this.cancel();
  }

  // --- Internals ---

  private async runPasses(passes: Pass[], length: number, output: string) {
    let error: string | null = null;
    for (const pass of passes) {
      if (this.canceled) break;
      this.job = { ...this.job, step: pass.step };
      this.emit();
      error = await this.runFfmpeg(pass, length);
      if (error) break;
    }

    await this.cleanupAfter?.().catch(() => {});
    this.cleanupAfter = null;
    this.child = null;

    if (this.canceled || error) {
      await rm(output, { force: true });
      this.job = { ...this.job, state: this.canceled ? "canceled" : "error", error: this.canceled ? null : error, output: null };
    } else {
      const { size } = await stat(output);
      this.job = { ...this.job, state: "done", step: null, percent: 100, outputSize: size };
    }
    this.emit();
  }

  /** Run one ffmpeg pass, reporting progress. Returns an error message, or null. */
  private runFfmpeg(pass: Pass, length: number) {
    return new Promise<string | null>((resolve) => {
      const args = ["-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...pass.args];
      const child = spawn(ffmpegPath!, args, { windowsHide: true, detached: process.platform !== "win32" });
      this.child = child;

      let stderr = "";
      let lastEmit = 0;
      child.stderr.on("data", (data) => (stderr += data));
      child.stdout.on("data", (data: Buffer) => {
        // -progress prints key=value lines, e.g. "out_time_us=1234567".
        const time = /out_time_us=(\d+)/.exec(data.toString())?.[1];
        if (!time) return;
        const done = Math.min(1, Number(time) / 1e6 / length);
        this.job = { ...this.job, percent: 100 * (pass.offset + pass.weight * done) };
        if (Date.now() - lastEmit > 250) {
          lastEmit = Date.now();
          this.emit();
        }
      });
      child.on("error", (err) => resolve(err.message));
      child.on("close", (code) => resolve(code === 0 ? null : stderr.trim().split(/\r?\n/).slice(-3).join("\n") || `ffmpeg exited with code ${code}.`));
    });
  }

  private async removePassLogs(prefix: string) {
    // x264 writes <prefix>-0.log and <prefix>-0.log.mbtree.
    await Promise.all([`${prefix}-0.log`, `${prefix}-0.log.mbtree`, `${prefix}-0.log.temp`, `${prefix}-0.log.mbtree.temp`]
      .map((file) => rm(file, { force: true })));
  }

  private emit() {
    this.host.emit(TOOL_ID, "job", this.job);
  }
}

const tool: Tool = {
  name: "Video Editor",
  description: "Trim videos, remove their audio or video, and compress them to make files smaller.",
  createApi: (host) => new VideoEditorApi(host),
};

export default tool;
