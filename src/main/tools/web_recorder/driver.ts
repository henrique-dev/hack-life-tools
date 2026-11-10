import { app, BrowserWindow, session, type NativeImage, type Session, type WebContents } from "electron";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { sleep } from "../../lib/util";
import * as page from "./page";
import { charKey, parseKeys, type Command, type KeyPress } from "./script";

/** Cookies and storage of the recorded pages, kept between runs so logins last. */
const PARTITION = "persist:web_recorder";
const FIND_TIMEOUT = 10_000;
const LOAD_TIMEOUT = 30_000;
const POLL_MS = 120;
const MOVE_FRAME_MS = 16;
const TYPE_DELAY_MS = 75;

let configured: Session | null = null;

/**
 * The session shared by the recorder and its login window. Its user agent drops
 * the Electron and app names, which some sites use to refuse logins.
 */
export function recorderSession(): Session {
  if (!configured) {
    configured = session.fromPartition(PARTITION);
    const agent = configured.getUserAgent();
    configured.setUserAgent(agent.replace(new RegExp(` (Electron|${app.getName()})/\\S+`, "g"), ""));
  }
  return configured;
}

export class CanceledError extends Error {
  constructor() {
    super("Canceled.");
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const jitter = (ms: number) => ms * (0.7 + Math.random() * 0.6);

export interface DriverOptions {
  width: number;
  height: number;
  fps: number;
  cursor: boolean;
  /** Multiplies movement, typing and pauses (see PACE_FACTOR). */
  pace: number;
  /** Folder of the script, for the relative paths of upload; null if it was never saved. */
  scriptFolder: string | null;
  signal: AbortSignal;
  onFrame(image: NativeImage): void;
}

/**
 * Runs script commands in an offscreen window (rendered without being shown, at
 * an exact size). Mouse and keyboard go through Chrome's DevTools protocol as
 * real input events, so hover effects, focus and page shortcuts work. A cursor,
 * click effects, captions and highlights are drawn by an overlay in the page.
 */
export class PageDriver {
  private window: BrowserWindow | null = null;
  /** In CSS pixels of the page, like the protocol's input coordinates (they follow the zoom). */
  private mouse: { x: number; y: number };
  private zoom = 1;
  private caption: string | null = null;

  constructor(private readonly options: DriverOptions) {
    this.mouse = { x: options.width / 2, y: options.height / 2 };
  }

  private get contents(): WebContents {
    if (!this.window || this.window.isDestroyed()) throw new Error("The page was closed.");
    return this.window.webContents;
  }

  async start() {
    const { width, height } = this.options;
    const window = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      frame: false,
      enableLargerThanScreen: true,
      webPreferences: { offscreen: true, session: recorderSession(), backgroundThrottling: false },
    });
    this.window = window;
    const contents = window.webContents;
    window.setContentSize(width, height);
    contents.setFrameRate(this.options.fps);
    contents.on("paint", (_event, _dirty, image) => this.options.onFrame(image));
    // Links that open a new tab or window open in the recorded page instead.
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    // "Leave site?" prompts would stop the script.
    contents.on("will-prevent-unload", (event) => event.preventDefault());
    contents.on("dom-ready", () => this.restoreOverlay());

    // The protocol only answers once the page has a renderer process.
    await contents.loadURL("about:blank");
    contents.debugger.attach("1.3");
    // alert(), confirm() and prompt() are accepted, or they would block the page.
    contents.debugger.on("message", (_event, method) => {
      if (method === "Page.javascriptDialogOpening") {
        contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    });
    await contents.debugger.sendCommand("Page.enable");
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** Ask for a new frame, e.g. when the video starts. */
  repaint() {
    this.contents.invalidate();
  }

  /** Pause, stopping early if the run is canceled. */
  async wait(ms: number) {
    const end = Date.now() + ms;
    for (;;) {
      this.check();
      const left = end - Date.now();
      if (left <= 0) return;
      await sleep(Math.min(left, 100));
    }
  }

  /** Pause by the pace setting, e.g. between steps. */
  pause(ms: number) {
    return this.wait(ms * this.options.pace);
  }

  async run(command: Command) {
    switch (command.kind) {
      case "goto":
        return this.goto(command.url);
      case "wait":
        return this.wait(command.ms);
      case "waitFor":
        await this.locate(command.target, command.timeoutMs ?? FIND_TIMEOUT);
        return;
      case "click":
        return this.click(command.target);
      case "hover": {
        const rect = await this.reveal(command.target);
        return this.moveTo(rect.x + rect.width / 2, rect.y + rect.height / 2);
      }
      case "type":
        if (command.target) {
          await this.click(command.target);
          await this.pause(150);
        }
        return this.type(command.text);
      case "press":
        await this.press(parseKeys(command.keys)!);
        return this.settle();
      case "select": {
        const rect = await this.reveal(command.target);
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        await this.moveTo(x, y);
        // Without a real click: the list's popup is not drawn offscreen.
        await this.eval(page.overlay, "ripple", [x, y]);
        const error = await this.eval(page.selectOption, command.option);
        if (error) throw new Error(error);
        return;
      }
      case "drag":
        return this.drag(command.target, command.to);
      case "upload":
        return this.upload(command.target, command.files);
      case "scroll":
        return this.wheel(command.by, command.axis);
      case "scrollTo":
        await this.reveal(command.target);
        return;
      case "scrollEdge":
        await this.eval(page.scrollToEdge, command.edge);
        return this.waitForScroll();
      case "highlight": {
        await this.reveal(command.target);
        const rect = await this.eval(page.targetRect);
        if (rect) await this.eval(page.overlay, "highlight", [rect, command.ms]);
        return this.wait(command.ms + 300);
      }
      case "caption":
        this.caption = command.text;
        await this.eval(page.overlay, "caption", [command.text]);
        return;
      case "zoom":
        this.zoom = command.factor;
        if (this.contents.getURL()) {
          this.contents.setZoomFactor(this.zoom);
          await this.wait(200);
        }
        return;
    }
  }

  /** Whether an element is on the page, looking for it up to timeoutMs (once, when 0). */
  async isVisible(target: string, timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      this.check();
      // Fails while the page is navigating: try again.
      const found = await this.eval(page.findTarget, target).catch(() => null);
      if (found && "error" in found) throw new Error(found.error);
      if (found) return true;
      if (Date.now() >= end) return false;
      await this.wait(POLL_MS);
    }
  }

  private check() {
    if (this.options.signal.aborted) throw new CanceledError();
  }

  private eval<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<R> {
    const call = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
    return this.contents.executeJavaScript(call);
  }

  private input(method: string, params: object) {
    return this.contents.debugger.sendCommand(method, params);
  }

  /** Put the overlay in a newly loaded page, with the cursor where it was. */
  private restoreOverlay() {
    if (!this.window || this.window.isDestroyed()) return;
    // The zoom is kept per site; set it again for each page.
    this.contents.setZoomFactor(this.zoom);
    const state: page.OverlayState = {
      x: this.mouse.x,
      y: this.mouse.y,
      cursor: this.options.cursor,
      caption: this.caption,
    };
    this.eval(page.installOverlay, state).catch(() => {});
  }

  private async goto(url: string) {
    try {
      await this.contents.loadURL(url);
    } catch (err) {
      // ERR_ABORTED: the page redirected, or another navigation replaced this one.
      const message = err instanceof Error ? err.message : String(err);
      if (!/ERR_ABORTED/.test(message))
        throw new Error(`Could not open ${url}: ${message.replace(/ loading '.*'$/, "")}`);
    }
    await this.settle();
  }

  /** Wait for a navigation that the last action may have started. */
  private async settle() {
    await this.wait(200);
    const end = Date.now() + LOAD_TIMEOUT;
    while (this.contents.isLoading() && Date.now() < end) await this.wait(POLL_MS);
  }

  /** Wait until an element matches; returns where it is, in CSS pixels. */
  private async locate(target: string, timeoutMs = FIND_TIMEOUT) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      this.check();
      // Fails while the page is navigating: try again.
      const found = await this.eval(page.findTarget, target).catch(() => null);
      if (found && "error" in found) throw new Error(found.error);
      if (found) return found;
      if (Date.now() > end)
        throw new Error(`Nothing on the page matches "${target}" (waited ${Math.round(timeoutMs / 1000)} s).`);
      await this.wait(POLL_MS);
    }
  }

  /** Find an element and scroll it into view if needed; returns its rectangle. */
  private async reveal(target: string) {
    const found = await this.locate(target);
    let rect: page.CssRect | null = found.rect;
    if (!found.inView) {
      await this.eval(page.scrollTargetIntoView);
      rect = await this.waitForStill();
    }
    if (!rect) throw new Error(`"${target}" disappeared from the page.`);
    return rect;
  }

  /** Wait until the found element stops moving (smooth scrolling, animations). */
  private async waitForStill() {
    let last = "";
    let still = 0;
    const end = Date.now() + 3000;
    for (;;) {
      await this.wait(60);
      const rect = await this.eval(page.targetRect).catch(() => null);
      const key = JSON.stringify(rect);
      still = key === last ? still + 1 : 0;
      last = key;
      if (!rect || still >= 3 || Date.now() > end) return rect;
    }
  }

  private async waitForScroll() {
    let last = "";
    let still = 0;
    const end = Date.now() + 4000;
    while (still < 3 && Date.now() < end) {
      await this.wait(60);
      const key = JSON.stringify(await this.eval(page.scrollPosition).catch(() => null));
      still = key === last ? still + 1 : 0;
      last = key;
    }
  }

  /** Glide the mouse to a point, firing real mouse moves along the way (with the left button down when held). */
  private async moveTo(x: number, y: number, held = false) {
    const from = { ...this.mouse };
    const distance = Math.hypot(x - from.x, y - from.y);
    if (distance < 1) return;
    const duration = Math.min(1100, 250 + distance * 0.55) * this.options.pace;
    const start = Date.now();
    for (;;) {
      this.check();
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = easeInOut(t);
      this.mouse = { x: from.x + (x - from.x) * eased, y: from.y + (y - from.y) * eased };
      await this.input("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...this.mouse,
        button: held ? "left" : "none",
        buttons: held ? 1 : 0,
      });
      if (t >= 1) return;
      await sleep(MOVE_FRAME_MS);
    }
  }

  private async click(target: string) {
    const rect = await this.reveal(target);
    await this.moveTo(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await this.pause(120);
    const at = { ...this.mouse, button: "left", clickCount: 1 };
    await this.input("Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
    await sleep(70);
    await this.input("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
    await this.settle();
  }

  /** Press on an element, move with the button down and release, as real mouse events. */
  private async drag(target: string, to: string | { x: number; y: number }) {
    const rect = await this.reveal(target);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await this.moveTo(x, y);
    // Before pressing: scrolling with the button down would drag something else.
    const end = typeof to === "string" ? await this.dropPoint(to) : { x: x + to.x, y: y + to.y };
    await this.pause(120);
    await this.input("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...this.mouse,
      button: "left",
      clickCount: 1,
      buttons: 1,
    });
    await sleep(90);
    await this.moveTo(end.x, end.y, true);
    await this.pause(150);
    await this.input("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...this.mouse,
      button: "left",
      clickCount: 1,
      buttons: 0,
    });
    await this.settle();
  }

  private async dropPoint(target: string) {
    const found = await this.locate(target);
    if (!found.inView) throw new Error(`"${target}" is outside the visible part of the page: scroll to it first.`);
    return { x: found.rect.x + found.rect.width / 2, y: found.rect.y + found.rect.height / 2 };
  }

  /** Choose files for a file field without opening the file chooser, which is not drawn offscreen. */
  private async upload(target: string | null, files: string[]) {
    const paths = await Promise.all(files.map((file) => this.resolveFile(file)));
    const direct = await this.eval(page.findFileInput, target).catch(() => false);
    if (target && !direct) {
      const rect = await this.reveal(target);
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      await this.moveTo(x, y);
      await this.eval(page.overlay, "ripple", [x, y]);
      if (!(await this.eval(page.findFileInputOfTarget))) throw new Error(`"${target}" has no file field.`);
    } else if (!direct) {
      await this.waitForFileInput();
    }
    const { result } = await this.input("Runtime.evaluate", { expression: "window.__hltFileInput" });
    await this.input("DOM.setFileInputFiles", { files: paths, objectId: result.objectId });
    await this.settle();
  }

  private async waitForFileInput() {
    const end = Date.now() + FIND_TIMEOUT;
    while (!(await this.eval(page.findFileInput, null).catch(() => false))) {
      if (Date.now() > end) throw new Error("There is no file field on the page.");
      await this.wait(POLL_MS);
    }
  }

  private async resolveFile(file: string) {
    if (!isAbsolute(file) && !this.options.scriptFolder) {
      throw new Error(`Save the script or use an absolute path for "${file}".`);
    }
    const path = resolve(this.options.scriptFolder ?? "", file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`File not found: ${path}`);
    return path;
  }

  private async press(key: KeyPress) {
    const event = {
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      modifiers: key.modifiers,
    };
    await this.input("Input.dispatchKeyEvent", {
      type: key.text ? "keyDown" : "rawKeyDown",
      ...event,
      text: key.text,
      unmodifiedText: key.text,
    });
    await this.input("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  }

  /** Type one character at a time, with a slightly irregular rhythm like a person. */
  private async type(text: string) {
    for (const char of text) {
      this.check();
      const key = char === "\n" ? parseKeys("Enter") : charKey(char);
      if (key) await this.press(key);
      else await this.input("Input.insertText", { text: char });
      await sleep(jitter(TYPE_DELAY_MS * this.options.pace));
    }
  }

  /** Scroll with the mouse wheel where the cursor is, so scrollable panels under it scroll too. */
  private async wheel(by: number, axis: "x" | "y") {
    const duration = Math.min(2000, Math.max(400, Math.abs(by) * 1.2)) * this.options.pace;
    const start = Date.now();
    let done = 0;
    for (;;) {
      this.check();
      const t = Math.min(1, (Date.now() - start) / duration);
      const delta = Math.round(by * easeInOut(t) - done);
      if (delta) {
        await this.input("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...this.mouse,
          deltaX: axis === "x" ? delta : 0,
          deltaY: axis === "y" ? delta : 0,
        });
        done += delta;
      }
      if (t >= 1) break;
      await sleep(MOVE_FRAME_MS);
    }
    await this.waitForScroll();
  }
}
