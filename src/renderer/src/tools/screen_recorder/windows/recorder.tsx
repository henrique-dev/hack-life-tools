import { useEffect } from "react";
import { errorMessage, onToolEvent } from "../../../api";
import { call, TOOL_ID } from "../shared";

// Hidden window that does the capture. The main process answers
// getDisplayMedia() with the screen or window chosen in the UI, and this
// window streams the recorded data back to it.

// Preferred formats, best first. WebM is always supported.
const MIME_TYPES = [
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const CHUNK_MS = 1000;
const VIDEO_BITS_PER_SECOND = 8_000_000;

// React's StrictMode runs effects twice in development; record only once.
let started = false;

async function record() {
  const { fps, audio } = await call<{ fps: number; audio: string }>("recorderConfig");

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps }, audio: audio === "system" });
  if (audio && audio !== "system") {
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: audio } } });
    for (const track of microphone.getAudioTracks()) stream.addTrack(track);
  }

  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });

  // Send chunks one at a time, in order.
  let writes: Promise<unknown> = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    writes = writes.then(async () => call("recorderData", new Uint8Array(await event.data.arrayBuffer())));
  };
  recorder.onstop = async () => {
    for (const track of stream.getTracks()) track.stop();
    try {
      await writes;
      await call("recorderStopped");
    } catch (err) {
      await call("recorderFailed", errorMessage(err));
    }
  };

  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  onToolEvent(TOOL_ID, "stop-recorder", stop);
  // Ends by itself when the recorded window is closed.
  stream.getVideoTracks()[0].addEventListener("ended", stop);

  await call("recorderStarted", recorder.mimeType || mimeType);
  recorder.start(CHUNK_MS);
}

export default function RecorderWindow() {
  useEffect(() => {
    if (started) return;
    started = true;
    record().catch((err) => call("recorderFailed", errorMessage(err)));
  }, []);
  return null;
}
