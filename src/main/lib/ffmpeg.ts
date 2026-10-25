import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * Copy a MediaRecorder file into a regular one, without re-encoding.
 * MediaRecorder writes WebM without a duration and fragmented MP4, which some
 * players cannot seek; ffmpeg rewrites the container metadata.
 */
export function remux(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg-static has no binary for this platform."));
      return;
    }
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c", "copy"];
    if (output.endsWith(".mp4")) args.push("-movflags", "+faststart");
    args.push(output);

    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    ffmpeg.stderr.on("data", (data) => (stderr += data));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`)),
    );
  });
}
