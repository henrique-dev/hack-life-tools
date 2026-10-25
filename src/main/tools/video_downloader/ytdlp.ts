import { app, net } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { run } from "../../lib/process";

// yt-dlp (https://github.com/yt-dlp/yt-dlp) is downloaded from its official
// releases into the app's data folder and kept up to date from there.

const RELEASE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/** Name of the standalone yt-dlp executable for this platform in the release assets. */
function assetName(): string | null {
  const arm = process.arch === "arm64";
  if (process.platform === "win32") return arm ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos"; // universal binary
  if (process.platform === "linux") return arm ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return null;
}

export function ytdlpPath() {
  return join(app.getPath("userData"), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

export function isInstalled() {
  return existsSync(ytdlpPath());
}

export async function ytdlpVersion(): Promise<string | null> {
  if (!isInstalled()) return null;
  return (await run(ytdlpPath(), ["--version"]).catch(() => "")).trim() || null;
}

async function download(url: string) {
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}

/** Download the latest yt-dlp release and verify it against the published SHA-256 checksums. */
export async function installYtdlp() {
  const asset = assetName();
  if (!asset) throw new Error(`yt-dlp has no release for ${process.platform} (${process.arch}).`);

  const sums = await (await download(`${RELEASE_URL}/SHA2-256SUMS`)).text();
  // Lines look like "<sha256>  <asset name>".
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name?.replace(/^\*/, "") === asset)?.[0];
  if (!expected) throw new Error(`No checksum published for ${asset}.`);

  const data = Buffer.from(await (await download(`${RELEASE_URL}/${asset}`)).arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== expected) {
    throw new Error("The downloaded yt-dlp did not match its published checksum, so it was not installed.");
  }

  const target = ytdlpPath();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.download`, data, { mode: 0o755 });
  await rename(`${target}.download`, target);
}

/** Update yt-dlp in place with its own updater. Returns its last output line. */
export async function updateYtdlp() {
  const output = await run(ytdlpPath(), ["--update"], { timeout: 120_000 });
  return output.trim().split(/\r?\n/).at(-1) ?? "";
}
