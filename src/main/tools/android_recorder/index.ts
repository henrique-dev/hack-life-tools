import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Host } from "../../host";
import { remux } from "../../lib/ffmpeg";
import { run, which } from "../../lib/process";
import { idleStatus, type RecordingStatus } from "../../lib/recording";
import { sleep, timestamp, withTimeout } from "../../lib/util";
import type { Tool, ToolApi } from "../types";

const TOOL_ID = "android_recorder";
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 10_000;
// --no-window, needed to record without mirroring, appeared in scrcpy 2.3.
const MIN_SCRCPY_VERSION = [2, 3];
const SCRCPY_DOCS = "https://github.com/Genymobile/scrcpy#get-the-app";

const INSTALL_COMMANDS: Partial<Record<NodeJS.Platform, string>> = {
  win32: "winget install --exact Genymobile.scrcpy",
  darwin: "brew install scrcpy android-platform-tools",
  // Distribution packages are often too old; the snap follows upstream releases.
  linux: "sudo snap install scrcpy",
};

export interface Setup {
  scrcpy: string | null;
  adb: string | null;
  version: string | null;
  /** Installed scrcpy is older than MIN_SCRCPY_VERSION. */
  tooOld: boolean;
  minVersion: string;
  installCommand: string | null;
  docsUrl: string;
}

export interface Device {
  serial: string;
  /** "device" when ready; also "unauthorized", "offline", ... */
  state: string;
  model: string | null;
}

export interface Settings {
  serial: string | null;
  audio: boolean;
  /** Longest side of the video in pixels; 0 keeps the device resolution. */
  maxSize: number;
  /** Show the phone screen on the computer while recording. */
  mirror: boolean;
}

export interface Options {
  setup: Setup;
  devices: Device[];
  settings: Settings;
  folder: string;
  status: RecordingStatus;
}

interface Recording {
  child: ChildProcess;
  baseName: string;
  tempPath: string;
  /** Last lines scrcpy printed, for error messages. */
  log: string[];
  exited: Promise<number | null>;
  finished: PromiseWithResolvers<void>;
  stopping: boolean;
}

function isOlder(version: string, minimum: number[]) {
  const parts = version.split(".").map(Number);
  for (let i = 0; i < minimum.length; i++) {
    const part = parts[i] ?? 0;
    if (part !== minimum[i]) return part < minimum[i];
  }
  return false;
}

/** Turn scrcpy's log into a readable error. */
function describeFailure(log: string[], code: number | null) {
  const errors = log.filter((line) => line.includes("ERROR:")).map((line) => line.replace(/^.*ERROR:\s*/, ""));
  const message = errors.join("\n") || log.slice(-5).join("\n") || `scrcpy exited with code ${code}.`;
  if (/Could not find any ADB device|device not found/i.test(message)) {
    return `${message}\nConnect the phone by USB, unlock it and check that USB debugging is enabled.`;
  }
  if (/unauthorized/i.test(message)) {
    return `${message}\nUnlock the phone and accept the "Allow USB debugging?" prompt.`;
  }
  return message;
}

/**
 * Records an Android device's screen with scrcpy (https://github.com/Genymobile/scrcpy),
 * which must be installed separately. scrcpy records to MKV, which stays valid
 * even if the process is terminated (on Windows it cannot be stopped with
 * Ctrl+C), and the file is then copied into an MP4 with ffmpeg.
 */
class AndroidRecorderApi implements ToolApi {
  private folder = app.getPath("videos");
  private settings: Settings = { serial: null, audio: true, maxSize: 0, mirror: true };
  private status: RecordingStatus = idleStatus();
  private recording: Recording | null = null;
  private setup: Setup | null = null;

  constructor(private readonly host: Host) {}

  async options(): Promise<Options> {
    const setup = await this.detect();
    const devices = await this.listDevices();
    // Select the first ready device if the remembered one is gone.
    if (!devices.some((device) => device.serial === this.settings.serial)) {
      this.settings.serial = (devices.find((device) => device.state === "device") ?? devices[0])?.serial ?? null;
    }
    return { setup, devices, settings: this.settings, folder: this.folder, status: this.status };
  }

  /** Look for scrcpy and adb again, e.g. after installing them. */
  async recheck() {
    this.setup = null;
    return this.options();
  }

  async listDevices(): Promise<Device[]> {
    const { adb } = await this.detect();
    if (!adb) return [];
    const output = await run(adb, ["devices", "-l"]);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("*") && !line.startsWith("List of devices"))
      .map((line) => {
        // e.g. "R58M123 device usb:1-1 product:beyond1 model:SM_G973F device:beyond1 transport_id:1"
        const [serial, state, ...properties] = line.split(/\s+/);
        const info = Object.fromEntries(properties.map((property) => property.split(":")));
        return { serial, state, model: info.model?.replaceAll("_", " ") ?? null };
      });
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
    const setup = await this.detect();
    if (!setup.scrcpy) throw new Error("scrcpy was not found.");
    if (setup.tooOld) throw new Error(`scrcpy ${setup.version} is too old; version ${setup.minVersion} or newer is needed.`);
    if (!settings.serial) throw new Error("Choose a device to record.");
    this.settings = settings;

    await mkdir(this.folder, { recursive: true });
    const baseName = `android_${timestamp()}`;
    const tempPath = join(this.folder, `${baseName}.part.mkv`);
    const args = [`--serial=${settings.serial}`, `--record=${tempPath}`, "--window-title=Android - Recording"];
    if (!settings.audio) args.push("--no-audio");
    if (settings.maxSize) args.push(`--max-size=${settings.maxSize}`);
    if (!settings.mirror) args.push("--no-window");

    const child = spawn(setup.scrcpy, args, {
      windowsHide: true,
      // scrcpy looks for adb on the PATH; point it to the one we found.
      env: setup.adb ? { ...process.env, ADB: setup.adb } : process.env,
    });
    const log: string[] = [];
    const collect = (data: Buffer) => {
      log.push(...data.toString().split(/\r?\n/).filter(Boolean));
      log.splice(0, Math.max(0, log.length - 30));
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const exited = new Promise<number | null>((resolve) => {
      child.on("close", resolve);
      child.on("error", (err) => {
        log.push(`ERROR: ${err.message}`);
        resolve(null);
      });
    });

    const recording: Recording = {
      child, baseName, tempPath, log, exited, finished: Promise.withResolvers(), stopping: false,
    };
    this.recording = recording;
    this.setStatus({ state: "starting", error: null });

    // Recording has started once scrcpy writes the file.
    let exitCode: number | null | undefined;
    exited.then((code) => (exitCode = code));
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (exitCode === undefined && Date.now() < deadline) {
      const size = (await stat(tempPath).catch(() => null))?.size ?? 0;
      if (size > 0) break;
      await sleep(250);
    }
    if (exitCode !== undefined || Date.now() >= deadline) {
      child.kill();
      await exited;
      await rm(tempPath, { force: true });
      this.recording = null;
      const error = exitCode !== undefined ? describeFailure(log, exitCode) : "Recording did not start in time.";
      this.setStatus({ state: "idle", error });
      throw new Error(error);
    }

    this.setStatus({ state: "recording", startedAt: Date.now(), output: null });
    // Also ends when the mirror window is closed or the phone is disconnected.
    exited.then((code) => this.finish(recording, code));
    return this.status;
  }

  async stop() {
    const recording = this.recording;
    if (!recording) return this.status;
    if (!recording.stopping) {
      recording.stopping = true;
      this.setStatus({ state: "saving" });
      // Ctrl+C lets scrcpy finish the file on macOS and Linux. Windows has no
      // equivalent, so the process is terminated; the MKV file is still valid.
      recording.child.kill(process.platform === "win32" ? undefined : "SIGINT");
    }
    try {
      await withTimeout(recording.finished.promise, STOP_TIMEOUT_MS, "scrcpy did not stop in time.");
    } catch {
      recording.child.kill("SIGKILL");
      await recording.finished.promise;
    }
    return this.status;
  }

  async shutdown() {
    await this.stop();
  }

  private async finish(recording: Recording, code: number | null) {
    if (this.recording !== recording) return;
    this.recording = null;
    const duration = this.status.startedAt ? (Date.now() - this.status.startedAt) / 1000 : 0;

    // Stopped by us, or the mirror window was closed: no error.
    let error = recording.stopping || code === 0 ? null : describeFailure(recording.log, code);
    let output: string | null = null;
    const size = (await stat(recording.tempPath).catch(() => null))?.size ?? 0;
    if (size > 0) {
      const mp4Path = join(this.folder, `${recording.baseName}.mp4`);
      try {
        await remux(recording.tempPath, mp4Path);
        await rm(recording.tempPath);
        output = basename(mp4Path);
      } catch {
        // Keep the MKV file, which most players open too.
        await rm(mp4Path, { force: true });
        const mkvPath = join(this.folder, `${recording.baseName}.mkv`);
        await rename(recording.tempPath, mkvPath).catch((err) => (error ??= `Could not save the file: ${err.message}`));
        output = basename(mkvPath);
      }
    } else {
      await rm(recording.tempPath, { force: true });
      error ??= "Nothing was recorded.";
    }

    this.setStatus({ state: "idle", startedAt: null, duration, output, error });
    recording.finished.resolve();
  }

  private setStatus(changes: Partial<RecordingStatus>) {
    this.status = { ...this.status, ...changes };
    this.host.emit(TOOL_ID, "status", this.status);
  }

  private async detect(): Promise<Setup> {
    if (this.setup) return this.setup;
    const scrcpy = which("scrcpy");
    let adb = which("adb");
    // The Windows release of scrcpy ships adb next to it.
    if (scrcpy && !adb) {
      const bundled = join(dirname(realpathSync(scrcpy)), process.platform === "win32" ? "adb.exe" : "adb");
      if (existsSync(bundled)) adb = bundled;
    }
    let version: string | null = null;
    if (scrcpy) {
      const output = await run(scrcpy, ["--version"]).catch(() => "");
      version = /scrcpy v?(\d+(?:\.\d+)*)/.exec(output)?.[1] ?? null;
    }
    this.setup = {
      scrcpy,
      adb,
      version,
      tooOld: version !== null && isOlder(version, MIN_SCRCPY_VERSION),
      minVersion: MIN_SCRCPY_VERSION.join("."),
      installCommand: INSTALL_COMMANDS[process.platform] ?? null,
      docsUrl: SCRCPY_DOCS,
    };
    return this.setup;
  }
}

const tool: Tool = {
  name: "Android Recorder",
  description: "Record the screen of an Android phone connected by USB, with scrcpy.",
  createApi: (host) => new AndroidRecorderApi(host),
};

export default tool;
