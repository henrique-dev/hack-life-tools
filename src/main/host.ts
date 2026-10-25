import { BrowserWindow, dialog, shell, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export const preloadPath = join(__dirname, "../preload/index.js");

/** Load the UI at a hash route: "" for the main window, "<tool id>/<window name>" for tool windows. */
export function loadRoute(window: BrowserWindow, route: string) {
  // Set by electron-vite in dev mode (npm run dev).
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    return window.loadURL(route ? `${devUrl}#/${route}` : devUrl);
  }
  return window.loadFile(join(__dirname, "../renderer/index.html"), route ? { hash: `/${route}` } : undefined);
}

/** Services the app offers to the tools' APIs. */
export class Host {
  constructor(readonly mainWindow: BrowserWindow) {}

  /** Show a folder picker and return the chosen path, or null if cancelled. */
  async pickFolder(initial: string): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.mainWindow, {
      defaultPath: initial,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  }

  /** Open a file or folder with the system's default application. */
  async openPath(path: string) {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  }

  /**
   * Open another window showing the UI registered for route ("<tool id>/<window name>",
   * see src/renderer/src/tools/index.ts).
   */
  openWindow(route: string, options: BrowserWindowConstructorOptions = {}) {
    const window = new BrowserWindow({
      ...options,
      webPreferences: { ...options.webPreferences, preload: preloadPath },
    });
    loadRoute(window, route);
    return window;
  }

  /** Send an event to every window. The UI listens with onToolEvent(). */
  emit(toolId: string, event: string, payload?: unknown) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("tool:event", toolId, event, payload);
    }
  }
}
