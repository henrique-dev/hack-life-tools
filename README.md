# hack-life-tools

A collection of small everyday desktop tools for Windows, macOS and Linux, built with
[Electron](https://www.electronjs.org/), React and Tailwind CSS.

## Running

Requires [Node.js](https://nodejs.org/) (22 or newer). Nothing else: `npm install` downloads Electron,
ffmpeg and sharp for your platform.

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

### Updates

The app checks at startup and every 30 minutes whether the branch it runs from (e.g. `main`) has new
commits on the remote. If so, a bar at the top of the window shows how many, with an **Update** button;
the bottom of the sidebar shows the version, branch and commit, and **Check for updates** checks again.

**Update** fast-forwards the branch (`git merge --ff-only`), so local work is never lost: if the folder
has local changes to the updated files, or commits that are not pushed, it says so and changes nothing.
**Restart now** then starts the app again through the launcher, which installs new dependencies and
rebuilds. Requires git; nothing is shown for a copy that is not a git clone.

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
- **Length**: export the **whole video**, or choose **Trim** to show the start and end, typed or taken from the
  player's current position.
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

### Image Converter

Converts images between JPEG, PNG, WebP, AVIF and GIF, and compresses or resizes them, using
[sharp](https://sharp.pixelplumbing.com/) (libvips). The originals are never changed: results are saved as new
files (`name.webp`, or `name_compressed.jpg` when the format stays the same) next to them or in a folder you choose.

- **Open** several images at once (JPEG, PNG, WebP, AVIF, GIF, TIFF, SVG) or drop them on the window. Click one to
  compare the original with the result side by side, at **Fit** or **100%** (both scroll together). The result and
  its size update as you change the settings.
- **Format**: keep each image's format (TIFF and SVG become PNG) or convert all to one. Transparent areas become white
  in JPEG. Animated GIF and WebP stay animated in WebP and GIF; other formats keep the first frame.
- **Compress**:

  | | JPEG / WebP / AVIF | PNG | GIF |
  | --- | --- | --- | --- |
  | None | highest quality (WebP is lossless from PNG, GIF, TIFF, SVG) | lossless | 256 colors |
  | Light / Medium / Strong | lower quality | reduced to a palette of 256 or 128 colors (like TinyPNG) | fewer colors |
  | Target size | highest quality under the size in KB, then smaller dimensions if needed | not available | not available |

  JPEG uses mozjpeg, which makes files about 10% smaller than standard JPEG at the same quality.
- **Max size**: limits the longest side (3840 to 800 px); smaller images are never enlarged.
- **Metadata** (camera, date, GPS location) is removed unless you choose to keep it. Photos are rotated according to
  their EXIF orientation first, so they still display upright.

iPhone HEIC photos are not supported (sharp's prebuilt libraries only decode AVIF among HEIF images). Export them as
JPEG from the phone (Settings > Camera > Formats > Most Compatible) or convert them first.

### Web Recorder

Records presentations of web apps. You write the steps in a simple script and the tool plays them in a
built-in browser, saving what the page shows as an MP4 video (H.264), with a drawn mouse cursor and click
effects.

```
caption "Creating a project"
goto localhost:3000
click text=New project
type #name "Marketing site"
select #template "Landing page"
click "button[type=submit]"
wait-for .project-header
caption off
highlight .project-header 2s
scroll down 600
wait 2s
```

- One command per line: `goto`, `click`, `hover`, `type`, `press`, `select`, `scroll`, `wait`, `wait-for`,
  `highlight`, `caption` and `zoom`. **Script commands** in the tool lists them; the full guide, with recipes and
  troubleshooting, is [docs/web-recorder](docs/web-recorder/README.md), and
  [docs/web-recorder/examples](docs/web-recorder/examples/) has scripts to start from. Lines starting with `#` are
  comments.
- Elements are found by CSS selector (`#email`, `button.primary`) or by their text (`text=Sign in`, which also
  matches placeholders and labels), and are waited for up to 10 seconds. Elements outside the screen are scrolled
  to first.
- The mouse and keyboard send real events, so hover effects, focus and shortcuts work. The cursor glides to each
  element and text is typed one key at a time; **Pace** makes all of it slower or faster.
- `caption "..."` shows a subtitle until the next caption or `caption off`; `highlight` dims the page around an
  element for a moment.
- The page is rendered offscreen at exactly the chosen resolution (720p, 1080p or 1440p, 30 or 60 FPS), so
  nothing else on the screen appears in the video and the computer can be used meanwhile. The video starts once
  the first page has loaded. **Test run** plays the script without saving, with a live preview.
- Scripts can be saved as `.txt` files; the one being edited is also kept between sessions.
- **Logins:** **Log in...** opens the script's first page in a browser window using the recorder's browser,
  with back, forward, reload (F5) and an address bar, and developer tools on F12. Log in there and close it:
  recordings reuse its cookies, so they start logged in. **Clear saved logins** forgets them.
- Not recorded: the page's sound, and native dropdown popups (`select` picks the option without opening the
  list). `alert()` and similar dialogs are accepted automatically, and links that open a new tab open in the same
  page. Elements inside iframes cannot be targeted. Some sites block automated or embedded browsers (e.g. Google
  sign-in); log in with another method or record a local or staging copy.

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
    updater.ts                  checks the git branch for new commits, updates, restarts
    host.ts                     services for tools: extra windows, folder picker, events
    lib/                        shared helpers (ffmpeg runner and file probing, media://
                                protocol for local previews, processes, recording status, utils)
    tools/
      types.ts                  Tool interface
      screen_recorder/          recording control, file writing
      android_recorder/         scrcpy detection, devices, recording
      video_downloader/         yt-dlp install/update, download queue
      video_editor/             export commands; formats.ts (output formats, also used by the UI)
      image_converter/          conversion with sharp; formats.ts (output formats, also used by the UI)
      web_recorder/             script.ts (script language, also used by the UI), driver.ts (offscreen
                                browser driven by the DevTools protocol), page.ts (code run in the page:
                                cursor, captions, finding elements), encoder.ts (frames to MP4)
  preload/index.ts              exposes window.api to the UI
  renderer/                     React + Tailwind UI
    src/api.ts                  callTool(), onToolEvent()
    src/App.tsx                 sidebar + active tool
    src/components/             shared UI: form fields, recording controls and status, update bar
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
    src/tools/image_converter/
      index.tsx                 main screen
    src/tools/web_recorder/
      index.tsx                 script editor, settings, preview
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
