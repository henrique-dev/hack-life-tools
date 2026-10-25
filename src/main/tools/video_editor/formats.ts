// Output formats of the Video Editor. Plain data and functions only, so the UI
// can import this module too (e.g. to tell whether a file will be copied or
// re-encoded).

export type OutputFormat =
  | "mp4" | "webm" | "mkv" | "mov" | "avi"
  | "gif" | "webp"
  | "mp3" | "m4a" | "wav" | "flac" | "ogg";

export type FormatKind = "video" | "animated" | "audio";

export interface FormatInfo {
  kind: FormatKind;
  label: string;
  /** Codecs (as ffmpeg names them) that can be copied into this container without re-encoding. */
  copyVideo?: string[] | "any";
  copyAudio?: string[] | "any";
}

export const FORMATS: Record<OutputFormat, FormatInfo> = {
  mp4: { kind: "video", label: "MP4", copyVideo: ["h264", "hevc", "av1", "vp9", "mpeg4"], copyAudio: ["aac", "mp3", "opus", "alac", "flac"] },
  webm: { kind: "video", label: "WebM", copyVideo: ["vp8", "vp9", "av1"], copyAudio: ["opus", "vorbis"] },
  mkv: { kind: "video", label: "MKV", copyVideo: "any", copyAudio: "any" },
  mov: { kind: "video", label: "MOV", copyVideo: ["h264", "hevc", "mpeg4", "prores"], copyAudio: ["aac", "mp3", "alac", "pcm_s16le"] },
  avi: { kind: "video", label: "AVI", copyVideo: ["mpeg4", "h264", "mjpeg"], copyAudio: ["mp3", "pcm_s16le", "ac3"] },
  gif: { kind: "animated", label: "GIF" },
  webp: { kind: "animated", label: "WebP" },
  mp3: { kind: "audio", label: "MP3" },
  m4a: { kind: "audio", label: "M4A" },
  wav: { kind: "audio", label: "WAV" },
  flac: { kind: "audio", label: "FLAC" },
  ogg: { kind: "audio", label: "OGG" },
};

export const FORMATS_BY_KIND: Record<FormatKind, OutputFormat[]> = {
  video: ["mp4", "webm", "mkv", "mov", "avi"],
  animated: ["gif", "webp"],
  audio: ["mp3", "m4a", "wav", "flac", "ogg"],
};

export type Compression = "none" | "light" | "medium" | "strong" | "target";

export interface ExportSettings {
  format: OutputFormat;
  /** Video formats. */
  removeAudio: boolean;
  /** Video formats. "none" copies the streams when possible, otherwise re-encodes at high quality. */
  compression: Compression;
  /** For compression "target". */
  targetSizeMb: number;
  /** Video formats: shorter side in pixels; 0 keeps the original size. */
  maxSize: 0 | 1080 | 720 | 480;
  /** Animated formats. */
  fps: 10 | 15 | 20 | 25;
  /** Animated formats: width in pixels; 0 keeps the original width. */
  width: 0 | 320 | 480 | 640 | 800;
}

interface StreamCodecs {
  video: { codec: string } | null;
  audio: { codec: string } | null;
}

function allows(list: string[] | "any" | undefined, codec: string) {
  return list === "any" || (list?.includes(codec) ?? false);
}

/** Whether the export can copy the streams instead of re-encoding them. */
export function canCopy(settings: ExportSettings, info: StreamCodecs) {
  const format = FORMATS[settings.format];
  if (format.kind !== "video" || settings.compression !== "none" || settings.maxSize || !info.video) return false;
  const audioOk = settings.removeAudio || !info.audio || allows(format.copyAudio, info.audio.codec);
  return allows(format.copyVideo, info.video.codec) && audioOk;
}
