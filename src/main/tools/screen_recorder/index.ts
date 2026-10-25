import {
  app,
  BrowserWindow,
  desktopCapturer,
  screen,
  session,
  systemPreferences,
  type DesktopCapturerSource,
} from "electron";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Host } from "../../host";
import { remux } from "../../lib/ffmpeg";
import { idleStatus, type RecordingStatus } from "../../lib/recording";
import { errorMessage, timestamp, withTimeout } from "../../lib/util";
import type { Tool, ToolApi } from "../types";

const TOOL_ID = "screen_recorder";
const FPS_OPTIONS = [15, 30, 60];
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 10_000;
const OVERLAY_SIZE = { width: 220, height: 52 };
const OVERLAY_MARGIN_TOP = 16;

// On Wayland, apps cannot list screens or windows: the system shows its own
// picker when capture starts.
const usesSystemPicker = process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland";

export interface Source {
  id: string;
  name: string;
  type: "screen" | "window";
}

export interface Settings {
  source: "screen" | "window";
  screenId: string | null;
  windowId: string | null;
  fps: number;
  /** "" for no audio, "system" for system audio (Windows only), otherwise a microphone deviceId. */
  audio: string;
}

export type Status = RecordingStatus;

export interface Options {
  usesSystemPicker: boolean;
  screens: Source[];
  windows: Source[];
  fpsOptions: number[];
  systemAudio: boolean;
  folder: string;
  settings: Settings;
  status: Status;
  /** Shown above the form, e.g. a missing permission. */
  warning: string | null;
}

interface Recording {
  source: DesktopCapturerSource;
  baseName: string;
  started: PromiseWithResolvers<void>;
  finished: PromiseWithResolvers<void>;
  stopping: boolean;
  // Set once the recorder window reports the format it records in.
  file?: WriteStream;
  tempPath?: string;
  extension?: string;
}

/**
 * The capture itself runs in a hidden recorder window (src/renderer/src/tools/
 * screen_recorder/windows/recorder.tsx) with getDisplayMedia() and
 * MediaRecorder, so Chromium picks the right capture API on each platform. The
 * recorder streams the data back through the recorder*() methods, and this
 * class writes it to disk.
 */
class ScreenRecorderApi implements ToolApi {
  private folder = app.getPath("videos");
  private settings: Settings | null = null;
  private status: Status = idleStatus();
  private recording: Recording | null = null;
  private recorderWindow: BrowserWindow | null = null;
  private overlay: BrowserWindow | null = null;

  constructor(private readonly host: Host) {
    // Answers getDisplayMedia() in the recorder window with the source chosen in start().
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      if (!this.recording) {
        callback({});
        return;
      }
      callback({ video: this.recording.source, audio: this.settings?.audio === "system" ? "loopback" : undefined });
    });
  }

  async options(): Promise<Options> {
    const sources = usesSystemPicker ? [] : await this.listSources();
    const screens = sources.filter((source) => source.type === "screen");
    return {
      usesSystemPicker,
      screens,
      windows: sources.filter((source) => source.type === "window"),
      fpsOptions: FPS_OPTIONS,
      systemAudio: process.platform === "win32",
      folder: this.folder,
      settings: this.settings ?? { source: "screen", screenId: screens[0]?.id ?? null, windowId: null, fps: 30, audio: "" },
      status: this.status,
      warning: this.permissionWarning(),
    };
  }

  /** Screens and windows that can be recorded, excluding this app's own windows. */
  async listSources(): Promise<Source[]> {
    const own = new Set(BrowserWindow.getAllWindows().map((window) => window.getMediaSourceId()));
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    return sources
      .filter((source) => !own.has(source.id))
      .map((source) => ({ id: source.id, name: source.name, type: source.id.startsWith("screen:") ? "screen" : "window" }));
  }

  async chooseFolder() {
    const folder = await this.host.pickFolder(this.folder);
    if (folder) this.folder = folder;
    return this.folder;
  }

  openFolder() {
    return this.host.openPath(this.folder);
  }

  getStatus() {
    return this.status;
  }

  async start(settings: Settings) {
    if (this.recording) throw new Error("Already recording.");

    // With the system picker, getSources() shows the picker and returns the chosen source.
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    const wantedId = settings.source === "screen" ? settings.screenId : settings.windowId;
    const source = usesSystemPicker ? sources[0] : sources.find((s) => s.id === wantedId);
    if (!source) {
      throw new Error(
        usesSystemPicker ? "No screen or window was selected." : "That screen or window is no longer available. Refresh the list.",
      );
    }

    this.settings = settings;
    await mkdir(this.folder, { recursive: true });
    const recording: Recording = {
      source,
      baseName: `recording_${timestamp()}`,
      started: Promise.withResolvers(),
      finished: Promise.withResolvers(),
      stopping: false,
    };
    this.recording = recording;
    this.setStatus({ state: "starting", error: null });

    this.recorderWindow = this.host.openWindow(`${TOOL_ID}/recorder`, {
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    this.recorderWindow.on("closed", () => {
      this.recorderWindow = null;
      if (this.recording === recording) this.recorderFailed("The recorder window closed unexpectedly.");
    });

    try {
      await withTimeout(recording.started.promise, START_TIMEOUT_MS, "Recording did not start in time.");
    } catch (err) {
      this.recording = null;
      this.recorderWindow?.destroy();
      this.setStatus({ state: "idle", error: errorMessage(err) });
      throw err;
    }

    // While recording, swap the main window for a small floating overlay with
    // the timer and a stop button.
    this.showOverlay();
    this.host.mainWindow.minimize();
    return this.status;
  }

  async stop() {
    const recording = this.recording;
    if (!recording) return this.status;
    if (!recording.stopping) {
      recording.stopping = true;
      this.setStatus({ state: "saving" });
      this.host.emit(TOOL_ID, "stop-recorder");
    }
    try {
      await withTimeout(recording.finished.promise, STOP_TIMEOUT_MS, "The recorder did not stop in time.");
    } catch {
      await this.finish(recording, "The recorder did not stop in time; the file may be incomplete.");
    }
    return this.status;
  }

  async shutdown() {
    await this.stop();
  }

  // --- Called by the recorder window ---

  recorderConfig() {
    if (!this.settings) throw new Error("Not recording.");
    return { fps: this.settings.fps, audio: this.settings.audio };
  }

  recorderStarted(mimeType: string) {
    const recording = this.recording;
    if (!recording) throw new Error("Not recording.");
    recording.extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    recording.tempPath = join(this.folder, `${recording.baseName}.part.${recording.extension}`);
    recording.file = createWriteStream(recording.tempPath);
    recording.file.on("error", (err) => this.recorderFailed(`Could not write the file: ${err.message}`));
    this.setStatus({ state: "recording", startedAt: Date.now(), output: null });
    recording.started.resolve();
  }

  recorderData(chunk: Uint8Array) {
    const file = this.recording?.file;
    if (!file) return;
    return new Promise<void>((resolve, reject) => file.write(chunk, (err) => (err ? reject(err) : resolve())));
  }

  async recorderStopped() {
    if (this.recording) await this.finish(this.recording, null);
  }

  async recorderFailed(message: string) {
    const recording = this.recording;
    if (!recording) return;
    if (!recording.file) {
      // Failed before recording started: start() reports the error.
      recording.started.reject(new Error(message));
      return;
    }
    await this.finish(recording, message);
  }

  // --- Internals ---

  private async finish(recording: Recording, error: string | null) {
    if (this.recording !== recording) return; // already finished
    this.recording = null;
    const duration = this.status.startedAt ? (Date.now() - this.status.startedAt) / 1000 : 0;

    let output: string | null = null;
    const { file, tempPath, extension } = recording;
    if (file && tempPath) {
      await new Promise<void>((resolve) => file.end(resolve));
      const finalPath = join(this.folder, `${recording.baseName}.${extension}`);
      try {
        await remux(tempPath, finalPath);
        await rm(tempPath);
      } catch {
        // Keep the file as MediaRecorder wrote it.
        await rm(finalPath, { force: true });
        await rename(tempPath, finalPath).catch((err) => (error ??= `Could not save the file: ${err.message}`));
      }
      output = basename(finalPath);
    }

    this.recorderWindow?.destroy();
    this.recorderWindow = null;
    this.overlay?.destroy();
    this.overlay = null;
    if (!this.host.mainWindow.isDestroyed()) this.host.mainWindow.restore();

    this.setStatus({ state: "idle", startedAt: null, duration, output, error });
    recording.finished.resolve();
  }

  private setStatus(changes: Partial<Status>) {
    this.status = { ...this.status, ...changes };
    this.host.emit(TOOL_ID, "status", this.status);
  }

  private showOverlay() {
    const { workArea } = screen.getPrimaryDisplay();
    this.overlay = this.host.openWindow(`${TOOL_ID}/overlay`, {
      ...OVERLAY_SIZE,
      useContentSize: true,
      x: Math.round(workArea.x + (workArea.width - OVERLAY_SIZE.width) / 2),
      y: workArea.y + OVERLAY_MARGIN_TOP,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#111827",
    });
    this.overlay.setAlwaysOnTop(true, "screen-saver");
    // Keeps the overlay out of the recording (Windows 10 2004+ and macOS; no effect on Linux).
    this.overlay.setContentProtection(true);
  }

  private permissionWarning() {
    if (process.platform !== "darwin" || systemPreferences.getMediaAccessStatus("screen") === "granted") return null;
    return "Allow screen recording for Electron in System Settings > Privacy & Security > Screen Recording, then restart the app.";
  }
}

const tool: Tool = {
  name: "Screen Recorder",
  description: "Record a screen or a single window to a video file, optionally with audio.",
  createApi: (host) => new ScreenRecorderApi(host),
};

export default tool;
