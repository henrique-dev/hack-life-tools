import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

// Folders where package managers put commands, in case they are missing from
// the PATH this app inherited (e.g. a terminal opened before installing).
function extraSearchDirs() {
  if (process.platform === "win32") return [join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links")];
  if (process.platform === "darwin") return ["/opt/homebrew/bin", "/usr/local/bin"];
  return ["/snap/bin", "/usr/local/bin"];
}

/** Full path of a command found on the PATH, or null. */
export function which(command: string): string | null {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  const dirs = [...(process.env.PATH ?? "").split(delimiter), ...extraSearchDirs()];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Run a command and return its stdout. Rejects with stderr if it fails without output. */
export function run(file: string, args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout ?? 15_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: options.env },
      (err, stdout, stderr) => {
        // Some tools exit with a non-zero code even when their output is valid.
        if (err && !stdout) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

/** Kill a process and the processes it started (e.g. yt-dlp's ffmpeg). */
export function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    // Children started with detached: true lead their own process group.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
