import type { NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { requireFfmpeg } from "../../lib/ffmpeg";

// Bytes waiting for ffmpeg before giving up: it is not keeping up with the frames.
const MAX_BACKLOG = 768 * 1024 * 1024;

/**
 * Writes the frames of an offscreen page to an H.264 MP4 at a constant frame rate.
 *
 * The page only paints when something changes, so the encoder keeps the latest
 * frame and writes it fps times per second, by the clock: a still page simply
 * repeats the same buffer, which costs no extra memory.
 */
export class FrameEncoder {
  private ffmpeg: ChildProcess | null = null;
  private closed: Promise<number | null> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private latest: NativeImage | null = null;
  private bitmap: Buffer | null = null;
  private dirty = false;
  private inputSize: { width: number; height: number } | null = null;
  private startedAt = 0;
  private written = 0;
  private stderr = "";
  /** Set when ffmpeg failed or cannot keep up; the recording stops with this error. */
  error: Error | null = null;

  constructor(
    readonly output: string,
    private readonly fps: number,
    private readonly width: number,
    private readonly height: number,
  ) {}

  /** A new frame from the page's "paint" event. The first one starts the video. */
  frame(image: NativeImage) {
    // A blank page can paint an empty frame.
    if (image.isEmpty()) return;
    this.latest = image;
    this.dirty = true;
    if (!this.ffmpeg && !this.error) this.begin(image.getSize());
  }

  /** Seconds recorded so far. */
  get duration() {
    return this.written / this.fps;
  }

  private begin(size: { width: number; height: number }) {
    this.inputSize = size;
    // On high-DPI screens the page may paint at a larger size: scale it down
    // (sharper text), keeping the aspect ratio if it ever differs.
    const scale =
      size.width === this.width && size.height === this.height
        ? []
        : [
            "-vf",
            `scale=${this.width}:${this.height}:flags=lanczos:force_original_aspect_ratio=decrease,` +
              `pad=${this.width}:${this.height}:(ow-iw)/2:(oh-ih)/2:color=white`,
          ];
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "bgra",
      "-s",
      `${size.width}x${size.height}`,
      "-framerate",
      String(this.fps),
      "-i",
      "pipe:0",
      ...scale,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      this.output,
    ];
    const ffmpeg = spawn(requireFfmpeg(), args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    this.ffmpeg = ffmpeg;
    ffmpeg.stderr!.on("data", (data) => (this.stderr = (this.stderr + data).slice(-4000)));
    ffmpeg.stdin!.on("error", (err) =>
      this.fail(new Error(this.stderr.trim() || `Could not write the video: ${err.message}`)),
    );
    this.closed = new Promise((resolve) => {
      ffmpeg.on("error", (err) => {
        this.fail(err);
        resolve(null);
      });
      ffmpeg.on("close", resolve);
    });
    this.startedAt = performance.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.fps / 2);
  }

  private fail(err: Error) {
    this.error ??= err;
    this.stop();
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Write the frames due by now. */
  private tick() {
    const stdin = this.ffmpeg?.stdin;
    if (!stdin || this.error || !stdin.writable) return;
    const due = Math.floor(((performance.now() - this.startedAt) * this.fps) / 1000) + 1;
    while (this.written < due) {
      stdin.write(this.currentBitmap());
      this.written++;
    }
    if (stdin.writableLength > MAX_BACKLOG) {
      this.fail(new Error("The computer cannot encode the video fast enough. Choose a lower resolution or 30 FPS."));
    }
  }

  private currentBitmap(): Buffer {
    if (this.dirty && this.latest) {
      let image = this.latest;
      const size = image.getSize();
      const input = this.inputSize!;
      if (size.width !== input.width || size.height !== input.height) image = image.resize(input);
      this.bitmap = image.toBitmap();
      this.dirty = false;
    }
    return this.bitmap!;
  }

  /** Write the last frames and close the file. Returns its length in seconds. */
  async finish(): Promise<number> {
    if (!this.ffmpeg) throw this.error ?? new Error("The page never showed anything, so nothing was recorded.");
    this.tick();
    this.stop();
    this.ffmpeg.stdin!.end();
    const code = await this.closed;
    if (this.error) throw this.error;
    if (code !== 0) throw new Error(this.stderr.trim() || `ffmpeg exited with code ${code}`);
    return this.duration;
  }

  /** Stop and delete the partial file. */
  async abort() {
    this.stop();
    if (this.ffmpeg) {
      this.ffmpeg.stdin!.destroy();
      this.ffmpeg.kill();
      await this.closed;
    }
    await rm(this.output, { force: true });
  }
}
