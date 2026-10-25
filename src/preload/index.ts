import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type ToolEventListener = (toolId: string, event: string, payload: unknown) => void;

// Exposed to the UI as window.api (wrapped by src/renderer/src/api.ts).
contextBridge.exposeInMainWorld("api", {
  listTools: () => ipcRenderer.invoke("tools:list"),
  callTool: (toolId: string, method: string, args: unknown[]) => ipcRenderer.invoke("tool:call", toolId, method, args),
  onToolEvent: (listener: ToolEventListener) => {
    const handler = (_event: IpcRendererEvent, toolId: string, event: string, payload: unknown) =>
      listener(toolId, event, payload);
    ipcRenderer.on("tool:event", handler);
    return () => ipcRenderer.removeListener("tool:event", handler);
  },
});
