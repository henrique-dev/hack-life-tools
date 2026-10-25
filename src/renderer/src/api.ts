// Bridge to the Electron main process, exposed by src/preload/index.ts as window.api.

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

interface Bridge {
  listTools(): Promise<ToolInfo[]>;
  callTool(toolId: string, method: string, args: unknown[]): Promise<unknown>;
  onToolEvent(listener: (toolId: string, event: string, payload: unknown) => void): () => void;
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

export function errorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // ipcRenderer.invoke() prefixes errors thrown in the main process.
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
