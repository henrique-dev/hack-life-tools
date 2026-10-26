import { app, BrowserWindow, ipcMain } from "electron";
import { Host, loadRoute, preloadPath } from "./host";
import { handleMediaProtocol, registerMediaScheme } from "./lib/media";
import { tools } from "./tools";
import type { ToolApi } from "./tools/types";

// On Wayland, screen capture goes through the desktop portal and PipeWire.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
}

registerMediaScheme();

let host: Host;
let mainWindow: BrowserWindow | undefined;
const apis = new Map<string, ToolApi>();

function getApi(toolId: string): ToolApi {
  let api = apis.get(toolId);
  if (!api) {
    const tool = tools[toolId];
    if (!tool) throw new Error(`Unknown tool "${toolId}".`);
    api = tool.createApi(host);
    apis.set(toolId, api);
  }
  return api;
}

ipcMain.handle("tools:list", () =>
  Object.entries(tools).map(([id, tool]) => ({ id, name: tool.name, description: tool.description })),
);

ipcMain.handle("tool:call", (_event, toolId: string, method: string, args: unknown[] = []) => {
  const api = getApi(toolId) as unknown as Record<string, unknown>;
  const fn = api[method];
  if (method.startsWith("_") || method === "constructor" || typeof fn !== "function") {
    throw new Error(`Invalid method "${method}".`);
  }
  return fn.apply(api, args);
});

function createMainWindow() {
  const window = new BrowserWindow({
    title: "Hack Life Tools",
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath },
  });
  mainWindow = window;
  host = new Host(window);
  loadRoute(window, "");

  // Closing the main window lets the tools finish (e.g. save a recording),
  // then closes their extra windows and quits.
  let closing = false;
  window.on("close", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    Promise.allSettled([...apis.values()].map((api) => api.shutdown?.())).finally(() => {
      for (const other of BrowserWindow.getAllWindows()) other.destroy();
      app.quit();
    });
  });
}

// Opening the app again (e.g. from the Chrome extension) brings the running
// window to the front instead of starting a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    handleMediaProtocol();
    createMainWindow();
  });
}
app.on("window-all-closed", () => app.quit());
