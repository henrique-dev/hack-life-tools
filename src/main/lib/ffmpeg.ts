import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { killTree } from "./process";

export function requireFfmpeg(): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform.");
  return ffmpegPath;
}

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

/** A path in dir that does not exist yet: "base.ext", "base (2).ext", ... */
export function uniquePath(dir: string, base: string, extension: string) {
  let candidate = join(dir, `${base}.${extension}`);
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base} (${i}).${extension}`);
  return candidate;
}

/** Seconds as an ffmpeg time argument. */
export function seconds(value: number) {
  return value.toFixed(3);
}

/** One ffmpeg run of a job. Most jobs have one; two-pass encoding has two. */
export interface FfmpegPass {
  args: string[];
  /** Shown in the UI, e.g. "Pass 1 of 2". */
  step: string | null;
  /** Share of the total progress this pass covers (0-1), and where it starts. */
  weight: number;
  offset: number;
}

export interface FfmpegJob {
  state: "idle" | "running" | "done" | "error" | "canceled";
  step: string | null;
  percent: number;
  output: string | null;
  /** Bytes, to show how much smaller the result is. */
  inputSize: number;
  outputSize: number | null;
  error: string | null;
}

export const idleFfmpegJob = (): FfmpegJob => ({
  state: "idle", step: null, percent: 0, output: null, inputSize: 0, outputSize: null, error: null,
});

/**
 * Runs ffmpeg jobs one at a time with progress and cancellation. A failed or
 * canceled job's partial output is deleted.
 */
export class FfmpegRunner {
  job: FfmpegJob = idleFfmpegJob();
  private child: ChildProcess | null = null;
  private canceled = false;

  constructor(private readonly onChange: (job: FfmpegJob) => void) {}

  get running() {
    return this.job.state === "running";
  }

  /**
   * Start a job. `length` is the duration of the output in seconds, used for
   * progress. `cleanup` removes temporary files (e.g. two-pass logs) at the end.
   */
  start(passes: FfmpegPass[], options: { length: number; output: string; inputSize: number; cleanup?: () => Promise<void> }) {
    if (this.running) throw new Error("A conversion is already running.");
    this.job = { ...idleFfmpegJob(), state: "running", output: options.output, inputSize: options.inputSize, step: passes[0]?.step ?? null };
    this.canceled = false;
    this.onChange(this.job);
    this.run(passes, options);
    return this.job;
  }

  cancel() {
    if (!this.running) return;
    this.canceled = true;
    if (this.child) killTree(this.child);
  }

  private async run(passes: FfmpegPass[], options: { length: number; output: string; cleanup?: () => Promise<void> }) {
    let error: string | null = null;
    for (const pass of passes) {
      if (this.canceled) break;
      this.update({ step: pass.step });
      error = await this.runPass(pass, options.length);
      if (error) break;
    }
    this.child = null;
    await options.cleanup?.().catch(() => {});

    if (this.canceled || error) {
      await rm(options.output, { force: true });
      this.update({ state: this.canceled ? "canceled" : "error", error: this.canceled ? null : error, output: null });
    } else {
      const { size } = await stat(options.output);
      this.update({ state: "done", step: null, percent: 100, outputSize: size });
    }
  }

  /** Run one ffmpeg pass. Returns an error message, or null. */
  private runPass(pass: FfmpegPass, length: number) {
    return new Promise<string | null>((resolve) => {
      const args = ["-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...pass.args];
      const child = spawn(requireFfmpeg(), args, { windowsHide: true, detached: process.platform !== "win32" });
      this.child = child;

      let stderr = "";
      let lastUpdate = 0;
      child.stderr.on("data", (data) => (stderr += data));
      child.stdout.on("data", (data: Buffer) => {
        // -progress prints key=value lines, e.g. "out_time_us=1234567".
        const time = /out_time_us=(\d+)/.exec(data.toString())?.[1];
        if (!time || Date.now() - lastUpdate < 250) return;
        lastUpdate = Date.now();
        const done = Math.min(1, Number(time) / 1e6 / length);
        this.update({ percent: 100 * (pass.offset + pass.weight * done) });
      });
      child.on("error", (err) => resolve(err.message));
      child.on("close", (code) =>
        resolve(code === 0 ? null : stderr.trim().split(/\r?\n/).slice(-3).join("\n") || `ffmpeg exited with code ${code}.`),
      );
    });
  }

  private update(changes: Partial<FfmpegJob>) {
    this.job = { ...this.job, ...changes };
    this.onChange(this.job);
  }
}
