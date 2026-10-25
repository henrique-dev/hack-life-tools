import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

// The media:// protocol lets the UI play local files (e.g. a <video> preview),
// including in development, where the UI is served over http. Only files
// registered with mediaUrl() are served, and range requests are supported so
// the player can seek.

const SCHEME = "media";
const allowed = new Set<string>();

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
};

/** Must run before the app is ready. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Must run after the app is ready. */
export function handleMediaProtocol() {
  protocol.handle(SCHEME, serve);
}

/** URL the UI can use to load a local file. */
export function mediaUrl(path: string) {
  allowed.add(path);
  return `${SCHEME}://file/${encodeURIComponent(path)}`;
}

async function serve(request: Request) {
  const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
  if (!allowed.has(path)) return new Response("Not found", { status: 404 });

  const { size } = await stat(path);
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  const body = (start: number, end: number) =>
    Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;

  // e.g. "bytes=1000-", "bytes=1000-1999" or "bytes=-500" (the last 500 bytes).
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range || (!range[1] && !range[2])) {
    return new Response(body(0, size - 1), { headers: { ...headers, "Content-Length": String(size) } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(body(start, end), {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
