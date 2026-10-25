import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import type { Host } from "../../host";
import { FfmpegRunner, requireFfmpeg, seconds, uniquePath, type FfmpegJob, type FfmpegPass } from "../../lib/ffmpeg";
import { probe, type MediaInfo } from "../../lib/probe";
import type { Tool, ToolApi } from "../types";
import { canCopy, FORMATS, type ExportSettings, type OutputFormat } from "./formats";

export type { Compression, ExportSettings, OutputFormat } from "./formats";
export type ExportJob = FfmpegJob;

const TOOL_ID = "video_editor";
const MIN_LENGTH = 0.1;
// Share of the target size reserved for the container, so the result stays under it.
const TARGET_SIZE_MARGIN = 0.96;
const MIN_VIDEO_KBPS = 50;

const MEDIA_EXTENSIONS = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

type Quality = "high" | "light" | "medium" | "strong";

/** Video and audio encoders of each video format, with their quality settings. */
const VIDEO_ENCODERS: Record<"h264" | "vp9" | "mpeg4", { args: string[]; quality: Record<Quality, string[]> }> = {
  h264: {
    args: ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"],
    quality: { high: ["-crf", "20"], light: ["-crf", "23"], medium: ["-crf", "28"], strong: ["-crf", "33"] },
  },
  vp9: {
    // Constant quality mode (-b:v 0); the other options trade a little size for speed.
    args: ["-c:v", "libvpx-vp9", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-pix_fmt", "yuv420p"],
    quality: {
      high: ["-crf", "28", "-b:v", "0"], light: ["-crf", "32", "-b:v", "0"],
      medium: ["-crf", "38", "-b:v", "0"], strong: ["-crf", "45", "-b:v", "0"],
    },
  },
  mpeg4: {
    args: ["-c:v", "mpeg4", "-pix_fmt", "yuv420p"],
    quality: { high: ["-q:v", "2"], light: ["-q:v", "4"], medium: ["-q:v", "7"], strong: ["-q:v", "12"] },
  },
};
const AUDIO_KBPS: Record<Quality, number> = { high: 192, light: 160, medium: 128, strong: 96 };

const VIDEO_FORMAT_CODECS: Partial<Record<OutputFormat, { video: keyof typeof VIDEO_ENCODERS; audio: string }>> = {
  mp4: { video: "h264", audio: "aac" },
  mkv: { video: "h264", audio: "aac" },
  mov: { video: "h264", audio: "aac" },
  webm: { video: "vp9", audio: "libopus" },
  avi: { video: "mpeg4", audio: "libmp3lame" },
};

const AUDIO_FORMAT_ARGS: Partial<Record<OutputFormat, string[]>> = {
  mp3: ["-c:a", "libmp3lame", "-q:a", "2"],
  m4a: ["-c:a", "aac", "-b:a", "192k"],
  wav: ["-c:a", "pcm_s16le"],
  flac: ["-c:a", "flac"],
  ogg: ["-c:a", "libvorbis", "-q:a", "5"],
};

export interface ExportRequest {
  path: string;
  /** Seconds. */
  start: number;
  end: number;
  settings: ExportSettings;
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

/**
 * Scale so the shorter side is at most maxSize (0: keep the size), with even
 * dimensions as most video codecs require. Quotes keep the commas inside each expression.
 */
function videoScale(maxSize: number) {
  if (!maxSize) return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const limit = (side: string) => `trunc(min(${side},${maxSize})/2)*2`;
  return `scale='if(gte(iw,ih),-2,${limit("iw")})':'if(gte(iw,ih),${limit("ih")},-2)'`;
}

/** Frame rate and width filters for GIF and WebP (never enlarges). */
function animatedFilters(settings: ExportSettings) {
  const filters = [`fps=${settings.fps}`];
  if (settings.width) filters.push(`scale='min(iw,${settings.width})':-1:flags=lanczos`);
  return filters.join(",");
}

/**
 * Trims, converts, removes audio or video, and compresses files with ffmpeg.
 * The original is never changed: the result is saved as a new file.
 */
class VideoEditorApi implements ToolApi {
  private settings: ExportSettings = {
    format: "mp4", removeAudio: false, compression: "none", targetSizeMb: 25, maxSize: 0, fps: 15, width: 480,
  };
  private folder: string | null = null;
  private runner = new FfmpegRunner((job) => this.host.emit(TOOL_ID, "job", job));

  constructor(private readonly host: Host) {}

  options(): Options {
    return { settings: this.settings, folder: this.folder, job: this.runner.job };
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
    return this.runner.job;
  }

  async export(request: ExportRequest) {
    if (this.runner.running) throw new Error("An export is already running.");
    requireFfmpeg();
    const { settings } = request;
    this.settings = settings;

    const info = await probe(request.path);
    const kind = FORMATS[settings.format].kind;
    const start = Math.max(0, request.start);
    const length = Math.min(info.duration, request.end) - start;
    if (length < MIN_LENGTH) throw new Error("The selection is too short.");
    if (kind === "audio" && !info.audio) throw new Error("This file has no audio.");
    if (kind !== "audio" && !info.video) throw new Error("This file has no video. Choose an audio format.");

    const { name } = parse(request.path);
    const folder = this.folder ?? dirname(request.path);
    const output = uniquePath(folder, kind === "video" ? `${name}_edited` : name, settings.format);
    // -ss and -t before -i limit what is read from the input. After -i, -t would
    // only limit the output, and filters that wait for the end of their input
    // (GIF's palettegen) would decode the whole file.
    const input = ["-ss", seconds(start), "-t", seconds(length), "-i", request.path];
    const noExtras = ["-sn", "-dn"];

    let passes: FfmpegPass[];
    let cleanup: (() => Promise<void>) | undefined;
    const single = (args: string[]): FfmpegPass[] => [{ args: [...input, ...args, output], step: null, weight: 1, offset: 0 }];

    if (kind === "audio") {
      passes = single(["-vn", ...noExtras, ...AUDIO_FORMAT_ARGS[settings.format]!]);
    } else if (settings.format === "gif") {
      // Build a palette from the clip itself for much better colors than GIF's default one.
      const filter = `${animatedFilters(settings)},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
      passes = single(["-an", ...noExtras, "-filter_complex", filter, "-loop", "0"]);
    } else if (settings.format === "webp") {
      passes = single(["-an", ...noExtras, "-vf", animatedFilters(settings), "-c:v", "libwebp_anim", "-lossless", "0",
        "-quality", "75", "-compression_level", "4", "-loop", "0"]);
    } else if (canCopy(settings, info)) {
      // Copy the streams without re-encoding: fast and lossless, but the cut
      // snaps to the nearest keyframe.
      const audio = settings.removeAudio ? ["-an"] : ["-c:a", "copy"];
      passes = single(["-c:v", "copy", ...audio, ...noExtras, "-avoid_negative_ts", "make_zero", ...this.containerArgs(settings.format)]);
    } else {
      const codecs = VIDEO_FORMAT_CODECS[settings.format]!;
      const encoder = VIDEO_ENCODERS[codecs.video];
      const keepAudio = !settings.removeAudio && info.audio;
      const video = ["-vf", videoScale(settings.maxSize), ...encoder.args];
      const tail = [...noExtras, ...this.containerArgs(settings.format)];

      if (settings.compression === "target") {
        // Two passes: the first analyzes the video so the second can hit the target size closely.
        const audioKbps = keepAudio ? AUDIO_KBPS.medium : 0;
        const totalKbps = (settings.targetSizeMb * 1024 * 1024 * 8 * TARGET_SIZE_MARGIN) / 1000 / length;
        const videoKbps = Math.floor(totalKbps - audioKbps);
        if (videoKbps < MIN_VIDEO_KBPS) {
          const minimum = Math.ceil((((MIN_VIDEO_KBPS + audioKbps) * 1000 * length) / 8 / TARGET_SIZE_MARGIN / 1024 / 1024) * 10) / 10;
          throw new Error(`${settings.targetSizeMb} MB is too small for ${Math.round(length)} seconds. Use at least ${minimum} MB or a shorter selection.`);
        }
        const passLog = join(tmpdir(), `hack-life-tools-${process.pid}-${Date.now()}`);
        const bitrate = ["-b:v", `${videoKbps}k`, "-passlogfile", passLog];
        const audio = keepAudio ? ["-c:a", codecs.audio, "-b:a", `${audioKbps}k`] : ["-an"];
        const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";
        passes = [
          { args: [...input, ...video, ...bitrate, "-pass", "1", "-an", "-f", "null", nullOutput], step: "Pass 1 of 2", weight: 0.5, offset: 0 },
          { args: [...input, ...video, ...bitrate, "-pass", "2", ...audio, ...tail, output], step: "Pass 2 of 2", weight: 0.5, offset: 0.5 },
        ];
        // x264 and libvpx write <prefix>-0.log (and x264 a .mbtree file).
        cleanup = () =>
          Promise.all(["-0.log", "-0.log.mbtree", "-0.log.temp", "-0.log.mbtree.temp"].map((suffix) => rm(passLog + suffix, { force: true })))
            .then(() => {});
      } else {
        // "none" reaches here when the streams cannot be copied: keep the quality high.
        const quality: Quality = settings.compression === "none" ? "high" : settings.compression;
        const audio = keepAudio ? ["-c:a", codecs.audio, "-b:a", `${AUDIO_KBPS[quality]}k`] : ["-an"];
        passes = single([...video, ...encoder.quality[quality], ...audio, ...tail]);
      }
    }

    return this.runner.start(passes, { length, output, inputSize: info.size, cleanup });
  }

  cancel() {
    this.runner.cancel();
    return this.runner.job;
  }

  shutdown() {
    this.runner.cancel();
  }

  /** Lets MP4 and MOV files start playing before they are fully downloaded. */
  private containerArgs(format: OutputFormat) {
    return format === "mp4" || format === "mov" ? ["-movflags", "+faststart"] : [];
  }
}

const tool: Tool = {
  name: "Video Editor",
  description: "Trim, convert (also to GIF), remove audio or video, and compress videos.",
  createApi: (host) => new VideoEditorApi(host),
};

export default tool;
