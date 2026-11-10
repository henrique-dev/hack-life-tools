import { app, BrowserWindow } from "electron";
import { readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Host } from "../../host";
import { requireFfmpeg, uniquePath } from "../../lib/ffmpeg";
import { errorMessage, timestamp } from "../../lib/util";
import type { Tool, ToolApi } from "../types";
import { CanceledError, PageDriver, recorderSession } from "./driver";
import { FrameEncoder } from "./encoder";
import {
  DEFAULT_SETTINGS,
  EXAMPLE_SCRIPT,
  PACE_FACTOR,
  parseScript,
  RESOLUTIONS,
  type Command,
  type RecorderSettings,
  type Step,
} from "./script";

export type { RecorderSettings } from "./script";

const TOOL_ID = "web_recorder";
// Pause after each step, so viewers can follow (times the pace).
const STEP_PAUSE_MS = 700;
// Commands that are not visible actions get no pause after them.
const NO_PAUSE = new Set<Command["kind"]>(["wait", "waitFor", "caption", "zoom"]);
// Still frames at the end, so the video does not stop on the last action.
const END_HOLD_MS = 1000;
const PREVIEW_INTERVAL_MS = 400;
const PREVIEW_WIDTH = 640;
const SAVE_DELAY_MS = 500;

export interface RunJob {
  state: "idle" | "running" | "done" | "error" | "canceled";
  /** false for a test run, which records nothing. */
  recording: boolean;
  /** Index of the current step, and the number of steps. */
  step: number;
  total: number;
  /** Line of the current step, or of the step that failed. */
  line: number | null;
  source: string | null;
  output: string | null;
  outputSize: number | null;
  /** Seconds of video. */
  duration: number;
  error: string | null;
}

export interface Options {
  script: string;
  /** File the script was opened from or saved to, or null. */
  scriptPath: string | null;
  settings: RecorderSettings;
  folder: string;
  job: RunJob;
}

interface Saved {
  script: string;
  scriptPath: string | null;
  settings: RecorderSettings;
  folder: string;
}

const idleJob = (): RunJob => ({
  state: "idle",
  recording: false,
  step: 0,
  total: 0,
  line: null,
  source: null,
  output: null,
  outputSize: null,
  duration: 0,
  error: null,
});

const SCRIPT_FILTERS = [
  { name: "Scripts", extensions: ["txt"] },
  { name: "All files", extensions: ["*"] },
];

/**
 * Records presentations of web apps: runs a script of navigation steps in an
 * offscreen browser and saves what the page shows as a video.
 */
class WebRecorderApi implements ToolApi {
  private saved: Saved;
  private saveTimer: NodeJS.Timeout | null = null;
  private job: RunJob = idleJob();
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  private loginWindow: BrowserWindow | null = null;

  constructor(private readonly host: Host) {
    const defaults: Saved = {
      script: EXAMPLE_SCRIPT,
      scriptPath: null,
      settings: DEFAULT_SETTINGS,
      folder: app.getPath("videos"),
    };
    try {
      const stored = JSON.parse(readFileSync(this.statePath(), "utf8")) as Partial<Saved>;
      this.saved = { ...defaults, ...stored, settings: { ...DEFAULT_SETTINGS, ...stored.settings } };
    } catch {
      this.saved = defaults;
    }
  }

  options(): Options {
    return { ...this.saved, job: this.job };
  }

  /** Keep the script being edited (saved in the app's data, so it survives a restart). */
  setScript(script: string) {
    this.saved.script = script;
    this.persist();
  }

  setSettings(settings: RecorderSettings) {
    this.saved.settings = settings;
    this.persist();
  }

  async openScript(): Promise<{ path: string; script: string } | null> {
    const path = await this.host.pickFile(SCRIPT_FILTERS, this.saved.scriptPath ?? undefined);
    if (!path) return null;
    const script = await readFile(path, "utf8");
    Object.assign(this.saved, { script, scriptPath: path });
    this.persist();
    return { path, script };
  }

  /** Save to the current file, or ask where (always with saveAs). Returns the path, or null if canceled. */
  async saveScript(script: string, saveAs: boolean): Promise<string | null> {
    let path = saveAs ? null : this.saved.scriptPath;
    path ??= await this.host.pickSaveFile(
      SCRIPT_FILTERS,
      this.saved.scriptPath ?? join(app.getPath("documents"), "presentation.txt"),
    );
    if (!path) return null;
    await writeFile(path, script.replace(/\r?\n/g, process.platform === "win32" ? "\r\n" : "\n"), "utf8");
    Object.assign(this.saved, { script, scriptPath: path });
    this.persist();
    return path;
  }

  /** Start a new script; the example is a starting point. */
  newScript() {
    Object.assign(this.saved, { script: EXAMPLE_SCRIPT, scriptPath: null });
    this.persist();
    return this.saved.script;
  }

  async chooseFolder() {
    const folder = await this.host.pickFolder(this.saved.folder);
    if (folder) {
      this.saved.folder = folder;
      this.persist();
    }
    return this.saved.folder;
  }

  /**
   * Open a normal window with the recorder's browser session, to log in to a site
   * by hand. The recordings then use the same cookies, so they start logged in.
   */
  openLogin(url: string) {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.loadURL(url).catch(() => {});
      this.loginWindow.focus();
      return;
    }
    const window = new BrowserWindow({
      title: "Log in - Web Recorder",
      width: 1280,
      height: 860,
      autoHideMenuBar: true,
      webPreferences: { session: recorderSession() },
    });
    this.loginWindow = window;
    window.on("closed", () => {
      this.loginWindow = null;
      this.host.emit(TOOL_ID, "loginClosed");
    });
    window.loadURL(url).catch(() => {});
  }

  /** Forget all logins, cookies and site data of the recorder's browser. */
  async clearLogins() {
    const session = recorderSession();
    await session.clearStorageData();
    await session.clearCache();
  }

  showFile(path: string) {
    this.host.showInFolder(path);
  }

  openFile(path: string) {
    return this.host.openPath(path);
  }

  getJob() {
    return this.job;
  }

  /** Run the script; with record false it is a test run that saves nothing. */
  run(script: string, settings: RecorderSettings, record: boolean) {
    if (this.job.state === "running") throw new Error("A script is already running.");
    const { steps, errors } = parseScript(script);
    if (errors.length) throw new Error(`Line ${errors[0].line}: ${errors[0].message}`);
    if (record) requireFfmpeg();
    Object.assign(this.saved, { script, settings });
    this.persist();

    this.abort = new AbortController();
    this.update({ ...idleJob(), state: "running", recording: record, total: steps.length });
    this.running = this.execute(steps, settings, record, this.abort.signal);
    return this.job;
  }

  cancel() {
    this.abort?.abort();
    return this.job;
  }

  async shutdown() {
    this.abort?.abort();
    await this.running;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      await this.writeState();
    }
  }

  private async execute(steps: Step[], settings: RecorderSettings, record: boolean, signal: AbortSignal) {
    const [width, height] = RESOLUTIONS[settings.resolution];
    let encoder: FrameEncoder | null = null;
    let lastPreview = 0;
    const driver = new PageDriver({
      width,
      height,
      fps: settings.fps,
      cursor: settings.cursor,
      pace: PACE_FACTOR[settings.pace],
      signal,
      onFrame: (image) => {
        encoder?.frame(image);
        const now = Date.now();
        if (now - lastPreview >= PREVIEW_INTERVAL_MS) {
          lastPreview = now;
          const jpeg = image.resize({ width: PREVIEW_WIDTH }).toJPEG(70);
          this.host.emit(TOOL_ID, "preview", `data:image/jpeg;base64,${jpeg.toString("base64")}`);
        }
      },
    });

    let current: Step | null = null;
    try {
      await driver.start();
      for (const [index, step] of steps.entries()) {
        current = step;
        this.update({ step: index, line: step.line, source: step.source });
        await driver.run(step.command);
        // The video starts once the first page has loaded, not on a blank window.
        if (record && !encoder && step.command.kind === "goto") {
          const output = uniquePath(this.saved.folder, `web_recording_${timestamp()}`, "mp4");
          encoder = new FrameEncoder(output, settings.fps, width, height);
          driver.repaint();
        }
        if (encoder?.error) throw encoder.error;
        if (!NO_PAUSE.has(step.command.kind)) await driver.pause(STEP_PAUSE_MS);
      }
      current = null;
      await driver.wait(END_HOLD_MS);

      if (encoder) {
        const duration = await encoder.finish();
        const { size } = await stat(encoder.output);
        this.update({ state: "done", output: encoder.output, outputSize: size, duration, line: null, source: null });
      } else {
        this.update({ state: "done", line: null, source: null });
      }
    } catch (err) {
      await encoder?.abort();
      if (err instanceof CanceledError) this.update({ state: "canceled" });
      else
        this.update({
          state: "error",
          error: current ? `Line ${current.line}: ${errorMessage(err)}` : errorMessage(err),
        });
    } finally {
      driver.close();
    }
  }

  private update(changes: Partial<RunJob>) {
    this.job = { ...this.job, ...changes };
    this.host.emit(TOOL_ID, "job", this.job);
  }

  private statePath() {
    return join(app.getPath("userData"), "web_recorder.json");
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeState().catch(() => {});
    }, SAVE_DELAY_MS);
  }

  private writeState() {
    return writeFile(this.statePath(), JSON.stringify(this.saved, null, 2), "utf8");
  }
}

const tool: Tool = {
  name: "Web Recorder",
  description: "Record presentations of web apps from a script of navigation steps.",
  createApi: (host) => new WebRecorderApi(host),
};

export default tool;
