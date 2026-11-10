import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { which } from "./lib/process";

// The app runs from a git clone (see README), so updating it means pulling the
// current branch and starting it again through the launcher, which installs
// new dependencies and rebuilds.

export interface UpdateStatus {
  /** "unavailable": not a git clone, git missing, no upstream branch or offline (see reason). */
  state: "up-to-date" | "behind" | "unavailable";
  reason?: string;
  version: string;
  branch?: string;
  /** Remote branch compared against, e.g. "origin/main". */
  upstream?: string;
  /** Short hashes of the running commit and of the latest one on the upstream branch. */
  current?: string;
  latest?: string;
  /** Commits on the upstream branch that are missing here, and local ones that are not pushed. */
  behind?: number;
  ahead?: number;
  /** Subjects of the missing commits, newest first (at most 10). */
  changes?: string[];
  checkedAt: number;
}

function git(args: string[], timeout = 15_000) {
  const gitPath = which("git");
  if (!gitPath) return Promise.reject(new Error("git is not installed."));
  return new Promise<string>((resolve, reject) => {
    execFile(
      gitPath,
      ["-C", app.getAppPath(), ...args],
      // Never wait for a password prompt in a window nobody sees.
      { timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const base = { version: app.getVersion(), checkedAt: Date.now() };
  let branch: string;
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
    branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    const reason = which("git") ? "The app is not running from a git clone." : "git is not installed.";
    return { ...base, state: "unavailable", reason };
  }
  if (branch === "HEAD") return { ...base, state: "unavailable", reason: "No branch is checked out." };

  const current = await git(["rev-parse", "--short", "HEAD"]);
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null);
  if (!upstream) {
    return {
      ...base,
      state: "unavailable",
      reason: `Branch "${branch}" does not track a remote branch.`,
      branch,
      current,
    };
  }

  try {
    const remote = await git(["config", `branch.${branch}.remote`]);
    await git(["fetch", "--quiet", remote], 60_000);
  } catch (err) {
    return {
      ...base,
      state: "unavailable",
      reason: `Could not reach the remote: ${err instanceof Error ? err.message : String(err)}`,
      branch,
      upstream,
      current,
    };
  }

  const [behind, ahead] = (await git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`]))
    .split(/\s+/)
    .map(Number);
  const latest = await git(["rev-parse", "--short", upstream]);
  const changes = behind
    ? (await git(["log", "--format=%s", "-n", "10", `HEAD..${upstream}`])).split("\n").filter(Boolean)
    : [];

  return {
    ...base,
    state: behind > 0 ? "behind" : "up-to-date",
    branch,
    upstream,
    current,
    latest,
    behind,
    ahead,
    changes,
  };
}

/** Bring the branch up to date with its upstream. Only fast-forwards, so local work is never lost. */
export async function applyUpdate() {
  try {
    await git(["merge", "--ff-only", "@{u}"], 60_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/would be overwritten|uncommitted|local changes/i.test(message)) {
      throw new Error(
        "The app folder has local changes to files the update modifies. Commit or discard them, then try again.",
      );
    }
    if (/not possible to fast-forward|diverg/i.test(message)) {
      throw new Error("This branch has local commits that are not on the remote. Update it with git (pull or rebase).");
    }
    throw new Error(message);
  }
}

/**
 * Start the app again through the launcher, which installs new dependencies and
 * rebuilds before opening its window. The caller then quits this instance, which
 * is gone by the time the new one asks for the single-instance lock.
 */
export function launchAgain() {
  const root = app.getAppPath();
  // Set by electron-vite in dev mode (npm run dev).
  const args = process.env.ELECTRON_RENDERER_URL ? ["dev"] : [];
  const env = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === "win32") {
    // "start" opens the launcher in its own console window, like a double-click,
    // so its messages stay readable if installing or building fails.
    const command = `start "Hack Life Tools" "${join(root, "run.bat")}" ${args.join(" ")}`;
    spawn(command, { cwd: root, env, shell: true, windowsHide: true, stdio: "ignore" }).unref();
  } else {
    spawn("sh", [join(root, "run.sh"), ...args], { cwd: root, env, detached: true, stdio: "ignore" }).unref();
  }
}
