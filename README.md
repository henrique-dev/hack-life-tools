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

### Chrome extension

`chrome-extension/` adds a toolbar button to Chrome that opens the app.

1. Run the launcher (`run.bat` or `run.sh`) once: it registers the `hacklife://` link that the extension
   uses (again on every run, so it follows the folder if it moves). On Windows this is a registry entry,
   on Linux `~/.local/share/applications/hacklife.desktop`, and on macOS a small
   `~/Applications/Hack Life Tools.app` that runs `run.sh`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick
   the `chrome-extension` folder.
3. Click the button. Chrome asks whether to open the app; check "Always allow" to skip the question.

If the app is already open, its window is brought to the front.

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
- Minimized windows are not listed, because Chromium cannot capture them. Restore the window and click
  Refresh.

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

### Android Recorder

Records the screen of an Android phone connected by USB, optionally with the phone's audio, using
[scrcpy](https://github.com/Genymobile/scrcpy). Nothing is installed on the phone.

Setup, once:

1. Install scrcpy 2.3 or newer. The app shows the right command if it is missing:

   | Platform | Command |
   | --- | --- |
   | Windows | `winget install --exact Genymobile.scrcpy` |
   | macOS | `brew install scrcpy android-platform-tools` |
   | Linux | `sudo snap install scrcpy` (distribution packages are often too old) |

2. On the phone, enable USB debugging: Settings > About phone > tap "Build number" 7 times, then
   Settings > System > Developer options > USB debugging.
3. Connect the phone with a USB cable that carries data (some cables only charge), unlock it and accept
   the "Allow USB debugging?" prompt.

Notes:

- Phone audio requires Android 11 or newer; on older versions only the video is recorded.
- Apps that block screen capture (banking, streaming) appear black.
- scrcpy records to MKV, which stays valid even if recording is interrupted, and the file is then
  converted to MP4 without re-encoding.
- With "Show the phone screen" enabled, the phone can also be controlled from that window; closing it
  stops the recording.

### Video Downloader

Downloads videos, or just their audio, from YouTube and
[thousands of other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), using
[yt-dlp](https://github.com/yt-dlp/yt-dlp).

- Paste a URL and click **Check** to see the title, length and thumbnail, then choose:
  - **Video**: best quality, 1080p, 720p or 480p, saved as MP4, optionally with subtitles.
  - **Audio only**: MP3 or M4A.
- Playlists can be downloaded whole, into a folder named after the playlist.
- Downloads run one at a time from a queue and can be canceled.
- The first time, the tool downloads yt-dlp from its official GitHub releases, verifies it against the
  published SHA-256 checksum and keeps it in the app's data folder. Sites change often: if a download
  that used to work fails, click **Update** at the bottom of the tool.
- YouTube needs a JavaScript runtime; the tool passes the Node.js used to run the app.

Only download content you have the right to save. DRM-protected services (Netflix, Spotify, ...) are not
supported.

### Video Editor

Edits and converts a video or audio file with ffmpeg. The original is never changed: the result is saved
as a new file (`name_edited.mp4`, `name.gif`, `name.mp3`, ...) next to it or in a folder you choose.

- **Open** a file with the button or by dropping it on the window. A player previews it.
- **Trim**: set the start and end, typing a time or using the player's current position.
- **Blur** parts of the frame (names, passwords, ...): click **Add area** and drag over the video. The
  player previews the blur. An area is blurred for the whole video unless you change its times. Blurring
  needs re-encoding, so the streams are never just copied.
- **Output** type and format:

  | Output | Formats | Codecs when re-encoding |
  | --- | --- | --- |
  | Video | MP4, MKV, MOV | H.264 + AAC |
  | | WebM | VP9 + Opus |
  | | AVI | MPEG-4 + MP3 |
  | GIF / WebP | GIF, animated WebP | frame rate and width to choose; no sound |
  | Audio only | MP3, M4A, WAV, FLAC, OGG | MP3, AAC, PCM, FLAC, Vorbis |

- For video, optionally **remove the audio** and **compress**:
  - **None**: copies the streams without re-encoding when the format allows it (e.g. MKV with H.264 to
    MP4). Instant and lossless, but cuts snap to the nearest keyframe, so they may be off by a few
    seconds. The tool says when the streams cannot be copied and will be re-encoded at high quality.
  - **Light / Medium / Strong**: re-encodes with increasing compression.
  - **Target size**: aims for a size in MB (e.g. to fit an upload limit), in two passes.
  - **Resolution**: optionally reduce it to 1080p, 720p or 480p.
- GIFs use a palette built from the clip for better colors. They get large quickly, so keep clips short
  or lower the frame rate and width; the tool warns for long selections.

### iPhone / iPad

There is no tool for iOS: Apple offers nothing like scrcpy for recording from a computer. Options:

- **On the device:** the built-in Screen Recording in Control Center (add it in Settings > Control
  Center if missing), then transfer the video with AirDrop or a cable. Works everywhere.
- **macOS:** QuickTime Player > File > New Movie Recording, then pick the iPhone as camera and
  microphone (cable required). On macOS 15 with iOS 18, iPhone Mirroring also works: record its window
  with the Screen Recorder.
- **Windows / Linux:** mirror the screen with an AirPlay receiver such as
  [UxPlay](https://github.com/FDH2/UxPlay), then record its window with the Screen Recorder. Quality
  depends on the Wi-Fi connection.

## Project structure

```
src/
  main/                         Electron main process
    index.ts                    main window, IPC
    host.ts                     services for tools: extra windows, folder picker, events
    lib/                        shared helpers (ffmpeg runner and file probing, media://
                                protocol for local previews, processes, recording status, utils)
    tools/
      types.ts                  Tool interface
      screen_recorder/          recording control, file writing
      android_recorder/         scrcpy detection, devices, recording
      video_downloader/         yt-dlp install/update, download queue
      video_editor/             export commands; formats.ts (output formats, also used by the UI)
  preload/index.ts              exposes window.api to the UI
  renderer/                     React + Tailwind UI
    src/api.ts                  callTool(), onToolEvent()
    src/App.tsx                 sidebar + active tool
    src/components/             shared UI: form fields, recording controls and status
    src/tools/screen_recorder/
      index.tsx                 main screen
      windows/overlay.tsx       floating timer with stop button
      windows/recorder.tsx      hidden window that does the capture
    src/tools/android_recorder/
      index.tsx                 main screen
    src/tools/video_downloader/
      index.tsx                 main screen
    src/tools/video_editor/
      index.tsx                 main screen
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
