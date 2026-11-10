// Bridge to the Electron main process, exposed by src/preload/index.ts as window.api.

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

/** Result of checkForUpdates(), see src/main/updater.ts. */
export interface UpdateStatus {
  state: "up-to-date" | "behind" | "unavailable";
  reason?: string;
  version: string;
  branch?: string;
  upstream?: string;
  current?: string;
  latest?: string;
  behind?: number;
  ahead?: number;
  changes?: string[];
  checkedAt: number;
}

interface Bridge {
  listTools(): Promise<ToolInfo[]>;
  callTool(toolId: string, method: string, args: unknown[]): Promise<unknown>;
  onToolEvent(listener: (toolId: string, event: string, payload: unknown) => void): () => void;
  getPathForFile(file: File): string;
  checkForUpdates(): Promise<UpdateStatus>;
  applyUpdate(): Promise<void>;
  restart(): Promise<void>;
}

declare global {
  interface Window {
    api: Bridge;
  }
}

export function listTools() {
  return window.api.listTools();
}

// Calls a public method of a tool's API in the main process, e.g.
// callTool("screen_recorder", "start", settings). Errors reject the promise.
export function callTool<T = unknown>(toolId: string, method: string, ...args: unknown[]) {
  return window.api.callTool(toolId, method, args) as Promise<T>;
}

// Listens to events a tool sends with host.emit(). Returns an unsubscribe function.
export function onToolEvent(toolId: string, event: string, listener: (payload: unknown) => void) {
  return window.api.onToolEvent((fromTool, name, payload) => {
    if (fromTool === toolId && name === event) listener(payload);
  });
}

/** Full path of a file dropped on the page. */
export function getPathForFile(file: File) {
  return window.api.getPathForFile(file);
}

/** Fetch the remote branch and compare it with the running version. */
export function checkForUpdates() {
  return window.api.checkForUpdates();
}

/** Pull the new commits (fast-forward only). */
export function applyUpdate() {
  return window.api.applyUpdate();
}

/** Start the updated app through the launcher and quit this one. */
export function restartApp() {
  return window.api.restart();
}

export function errorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // ipcRenderer.invoke() prefixes errors thrown in the main process.
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
