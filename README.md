# hack-life-tools

A collection of small everyday desktop tools for Windows, macOS and Linux, built with
[Electron](https://www.electronjs.org/), React and Tailwind CSS.

## Running

Requires [Node.js](https://nodejs.org/) (22 or newer). Nothing else: `npm install` downloads Electron
and ffmpeg for your platform.

```sh
git clone <repo url>
cd hack-life-tools
npm install
npm start
```

Or use the launcher, which installs the dependencies when needed:

| Platform | Open the app | Development mode (hot reload, dev tools) |
| --- | --- | --- |
| Windows | double-click `run.bat` | `run.bat dev` |
| macOS / Linux | `sh run.sh` | `sh run.sh dev` |

## Tools

### Screen Recorder

Records a screen or a single window to a video file, optionally with audio. While recording, the main
window is minimized and a floating timer with a stop button is shown.

- Files are saved as MP4 (H.264) when supported, otherwise WebM, in the Videos folder by default.
  Capture uses Chromium's `getDisplayMedia()` and `MediaRecorder`, and ffmpeg (`ffmpeg-static`) fixes the
  file's metadata afterwards so players can seek in it.
- Recordings have a variable frame rate: frames are only captured when the content changes, so the
  chosen FPS is a maximum. Most players handle this; some video editors prefer converting to a constant
  frame rate first.
- The recording ends by itself when the recorded window is closed.

Platform notes:

| | Windows | macOS | Linux (X11) | Linux (Wayland) |
| --- | --- | --- | --- | --- |
| Choose screen/window in the app | yes | yes | yes | no: the system asks when recording starts |
| System audio | yes | no | no (choose the "Monitor of ..." input if listed) | no (same) |
| Microphone | yes | yes | yes | yes |
| Floating timer hidden from the video | yes | yes | no | no |

- **macOS:** the first time, allow screen recording for Electron in System Settings > Privacy & Security >
  Screen Recording, then restart the app. macOS may ask again after Electron is updated.
- **Linux:** if the app does not start with an error about `chrome-sandbox`, your distribution restricts
  the Electron sandbox (e.g. Ubuntu 24.04). Run
  `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.

## Project structure

```
src/
  main/                         Electron main process
    index.ts                    main window, IPC
    host.ts                     services for tools: extra windows, folder picker, events
    tools/
      types.ts                  Tool interface
      screen_recorder/          recording control, file writing, ffmpeg remux
  preload/index.ts              exposes window.api to the UI
  renderer/                     React + Tailwind UI
    src/api.ts                  callTool(), onToolEvent()
    src/App.tsx                 sidebar + active tool
    src/tools/screen_recorder/
      index.tsx                 main screen
      windows/overlay.tsx       floating timer with stop button
      windows/recorder.tsx      hidden window that does the capture
```

## Adding a tool

1. Create `src/main/tools/my_tool/index.ts` with a default export of type `Tool` (see `types.ts`):
   a name, a description and `createApi(host)`, which returns an object whose public methods the UI can
   call. Arguments and results must be serializable. Optionally add `shutdown()`, called when the app
   quits.
2. Create `src/renderer/src/tools/my_tool/index.tsx` with a React component as default export. Call the
   main process with `callTool("my_tool", "methodName", ...args)` and listen to events sent with
   `host.emit()` using `onToolEvent()`, both from `src/api.ts`.
3. For extra windows, add `src/renderer/src/tools/my_tool/windows/<name>.tsx` and open it from the main
   process with `host.openWindow("my_tool/<name>", options)`.

Both sides are discovered automatically by folder name. Check types with `npm run typecheck`.
