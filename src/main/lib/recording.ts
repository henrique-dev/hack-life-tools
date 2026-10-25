/**
 * Status of a recording tool, sent to its UI with host.emit(toolId, "status", status)
 * and shown by src/renderer/src/components/recording.tsx.
 */
export interface RecordingStatus {
  state: "idle" | "starting" | "recording" | "saving";
  /** Date.now() when the current recording started. */
  startedAt: number | null;
  /** Length in seconds of the last finished recording. */
  duration: number;
  /** File name of the last finished recording. */
  output: string | null;
  error: string | null;
}

export const idleStatus = (): RecordingStatus => ({
  state: "idle",
  startedAt: null,
  duration: 0,
  output: null,
  error: null,
});
