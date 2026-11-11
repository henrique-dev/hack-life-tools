# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev`: run with hot reload and dev tools (electron-vite dev).
- `npm start`: build and run in preview mode (`electron-vite preview`).
- `npm run build`: production build into `out/`.
- `npm run typecheck`: `tsc --noEmit`. This is the only automated check: there are no tests and no linter.
- `run.bat` / `run.sh` (with an optional `dev` argument): the launchers end users run. They install dependencies when
  `package.json` changes (via the `node_modules/.package.json.installed` marker), re-download the Electron binary if
  missing, register the `hacklife://` URL scheme for the Chrome extension, then run `npm start` or `npm run dev`.

When running from a terminal inside VS Code, `ELECTRON_RUN_AS_NODE` must be unset or Electron runs as plain Node (the
launchers do this).

Formatting: 2-space indent, CRLF line endings (`.editorconfig`), and Prettier-style code with a 120-character line width.
There is no Prettier config file, so pass `--print-width 120` if you run it.

## Architecture

An Electron + React + Tailwind v4 app made of independent "tools", built with electron-vite (`src/main`, `src/preload`,
`src/renderer`). User-facing text is in English.

### Tools are discovered by folder name

- Main process: `src/main/tools/<id>/index.ts` default-exports a `Tool` (`name`, `description`, `createApi(host)`),
  found with `import.meta.glob` in `src/main/tools/index.ts`.
- UI: `src/renderer/src/tools/<id>/index.tsx` default-exports a React component, found by `src/renderer/src/tools/index.ts`.
  A tool shows in the sidebar only if both sides exist.
- Extra windows: `src/renderer/src/tools/<id>/windows/<name>.tsx`, opened from the main process with
  `host.openWindow("<id>/<name>")`, which loads the same renderer bundle at hash `#/<id>/<name>` (routing in `main.tsx`).

### IPC is generic, not one channel per feature

- The UI calls `callTool(toolId, method, ...args)` (`src/renderer/src/api.ts`), which goes through the `tool:call` channel
  to `src/main/index.ts`. That handler invokes the public method of the tool's API object, created lazily once per tool.
  Methods starting with `_` cannot be called. Arguments and results must be serializable.
- Main → UI: `host.emit(toolId, event, payload)` broadcasts to every window, and the UI subscribes with
  `onToolEvent(toolId, event, cb)`.
- On quit, the main window's `close` handler awaits every API's optional `shutdown()` (e.g. to finish saving a recording)
  before destroying the windows. Quit the app by closing the main window, not with `app.quit()`, to keep this.
- App-level features that are not tools use their own `app:*` channels: the git-based updater in `src/main/updater.ts`
  (`app:checkForUpdates`, `app:applyUpdate`, `app:restart`), exposed by `src/preload/index.ts`.
- The renderer imports **types** (and pure modules such as `video_editor/formats.ts`) straight from `src/main/tools/...`,
  so the two sides share one definition. Keep those modules free of Node/Electron imports if the renderer imports
  runtime values from them.

### Shared main-process services

- `src/main/host.ts` (`Host`): dialogs, opening paths, extra windows, `emit`, and `mediaUrl()`.
- `src/main/lib/media.ts`: the privileged `media://` protocol that lets the UI play local files (with range requests).
  Only paths registered through `mediaUrl()` are served.
- Images are processed with `sharp` (prebuilt libvips, N-API, so no Electron rebuild), with `sharp.cache(false)` so files
  are not kept open. `src/main/lib/ffmpeg.ts` / `probe.ts`: ffmpeg from `ffmpeg-static`. `process.ts`: `which()` (also searches
  WinGet/Homebrew/snap folders missing from PATH), `run()`, and `killTree()`.
- Web Recorder (`src/main/tools/web_recorder/`): an offscreen `BrowserWindow` driven through `webContents.debugger`
  (DevTools protocol). Input coordinates are CSS pixels of the page, already following the zoom. Functions in
  `page.ts` are sent to the page as source text (`fn.toString()`), so they must be self-contained, and they avoid
  `innerHTML`/`<style>` to work under strict CSP and Trusted Types. Frames from the `paint` event go to ffmpeg as
  raw BGRA at a constant frame rate (`encoder.ts`). Its browser session is the persistent partition
  `persist:web_recorder`, shared with the login window (`browser.ts`): a window from `host.openWindow()` whose own
  page is the navigation bar (`windows/browser.tsx`), with the site in a `WebContentsView` below it, so sites
  never get the app's preload. The script language is documented for users in
  `docs/web-recorder/README.md`: update it (and `COMMANDS` in `script.ts`) when commands or their rules change.
- `host.emit()` only reaches the app's own windows (the main window and those from `host.openWindow()`), not windows
  showing external sites.
- `src/main/lib/recording.ts`: `RecordingStatus`, shared by the recorder tools and `src/renderer/src/components/recording.tsx`.
- External binaries: yt-dlp is downloaded at runtime into `userData/bin` and verified against its SHA-256 sums; scrcpy
  must be installed by the user.

### Distribution model

There is no packaged installer. Users run a git clone through the launchers. The updater therefore works with git: it
fetches the current branch's upstream, fast-forwards only, then relaunches through `run.bat`/`run.sh` so new
dependencies are installed and the app is rebuilt. The app holds a single-instance lock, and a second launch (e.g. from
`chrome-extension/`, which opens `hacklife://open`) focuses the existing window.

Cross-platform behavior matters (Windows, macOS, Linux X11/Wayland). The README documents per-platform limitations for
each tool. Keep it updated when behavior changes, including its "Project structure" section.
