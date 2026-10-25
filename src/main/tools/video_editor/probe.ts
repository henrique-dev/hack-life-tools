import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import ffmpegPath from "ffmpeg-static";

export interface MediaInfo {
  path: string;
  name: string;
  /** Bytes. */
  size: number;
  /** Seconds. */
  duration: number;
  /** Display size, with phone rotation applied. */
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
}

/** Read a media file's duration and streams from `ffmpeg -i` (ffmpeg-static ships no ffprobe). */
export async function probe(path: string): Promise<MediaInfo> {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform.");
  // Without an output file ffmpeg exits with an error, but prints the input's details first.
  const output = await new Promise<string>((resolve) => {
    execFile(ffmpegPath!, ["-hide_banner", "-i", path], { windowsHide: true, timeout: 30_000 }, (_err, _stdout, stderr) =>
      resolve(stderr),
    );
  });

  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  if (!duration) {
    const reason = output.trim().split(/\r?\n/).at(-1) ?? "";
    throw new Error(`This file could not be read as audio or video.${reason ? `\n${reason}` : ""}`);
  }

  // e.g. "Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(...), 1920x1080 [SAR 1:1 DAR 16:9], ..."
  // Cover art in audio files is a video stream marked "(attached pic)".
  const videoLine = output.split(/\r?\n/).find((line) => /Stream #.*: Video: /.test(line) && !line.includes("attached pic"));
  const video = videoLine ? /Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(videoLine) : null;
  const audio = /Stream #.*: Audio: (\w+)/.exec(output);
  // Phone videos are often stored sideways with a rotation flag.
  const rotation = Math.abs(Number(/rotation of (-?[\d.]+) degrees/.exec(output)?.[1] ?? 0));
  const sideways = rotation === 90 || rotation === 270;

  return {
    path,
    name: basename(path),
    size: (await stat(path)).size,
    duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    video: video
      ? {
          codec: video[1],
          width: Number(sideways ? video[3] : video[2]),
          height: Number(sideways ? video[2] : video[3]),
        }
      : null,
    audio: audio ? { codec: audio[1] } : null,
  };
}
