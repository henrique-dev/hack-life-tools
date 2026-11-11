import { WebContentsView, type BrowserWindow, type Event, type Input } from "electron";
import type { Host } from "../../host";
import { recorderSession } from "./driver";
import { BROWSER_TOOLBAR_HEIGHT, normalizeUrl, type BrowserState } from "./script";

const TOOL_ID = "web_recorder";

/**
 * The login window: a normal browser window on the recorder's session, to log in
 * to sites by hand (and check pages) before recording. Its navigation bar is app
 * UI (src/renderer/src/tools/web_recorder/windows/browser.tsx) drawn by the
 * window itself; the site is a WebContentsView below it, so it never gets the
 * app's preload.
 */
export class LoginBrowser {
  readonly window: BrowserWindow;
  private readonly view: WebContentsView;

  constructor(host: Host, url: string, onClosed: () => void) {
    this.window = host.openWindow("web_recorder/browser", {
      title: "Log in - Web Recorder",
      width: 1280,
      height: 860,
      minWidth: 600,
      minHeight: 400,
      autoHideMenuBar: true,
    });
    this.view = new WebContentsView({ webPreferences: { session: recorderSession() } });
    this.window.contentView.addChildView(this.view);
    this.layout();
    this.window.on("resize", () => this.layout());

    const page = this.view.webContents;
    const update = () => host.emit(TOOL_ID, "browser", this.state());
    page.on("did-start-loading", update);
    page.on("did-stop-loading", update);
    page.on("did-navigate", update);
    page.on("did-navigate-in-page", update);
    page.on("page-title-updated", (_event, title) => {
      this.window.setTitle(title ? `${title} - Web Recorder` : "Web Recorder");
      update();
    });
    // The usual browser shortcuts, for the page wherever the focus is (the app's
    // menu would otherwise reload the navigation bar instead).
    page.on("before-input-event", (event, input) => this.shortcut(event, input));
    this.window.webContents.on("before-input-event", (event, input) => this.shortcut(event, input));

    this.window.on("closed", () => {
      if (!page.isDestroyed()) page.close();
      onClosed();
    });
    this.open(url);
  }

  open(url: string) {
    this.view.webContents.loadURL(url).catch(() => {});
    this.view.webContents.focus();
  }

  focus() {
    this.window.focus();
  }

  state(): BrowserState {
    const page = this.view.webContents;
    return {
      url: page.getURL(),
      title: page.getTitle(),
      loading: page.isLoading(),
      canGoBack: page.navigationHistory.canGoBack(),
      canGoForward: page.navigationHistory.canGoForward(),
    };
  }

  /** Open what was typed in the address bar. */
  navigate(input: string) {
    const url = normalizeUrl(input.trim());
    if (!url) throw new Error(`"${input}" is not a valid address.`);
    this.open(url);
  }

  back() {
    if (this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack();
  }

  forward() {
    if (this.view.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward();
  }

  /** Like F5; with hard, like Control+Shift+R (skips the cache). */
  reload(hard: boolean) {
    if (hard) this.view.webContents.reloadIgnoringCache();
    else this.view.webContents.reload();
  }

  stop() {
    this.view.webContents.stop();
  }

  private layout() {
    const [width, height] = this.window.getContentSize();
    this.view.setBounds({
      x: 0,
      y: BROWSER_TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - BROWSER_TOOLBAR_HEIGHT),
    });
  }

  private shortcut(event: Event, input: Input) {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const command = input.control || input.meta;
    if (key === "f5" || (command && key === "r")) {
      this.reload(input.shift || (key === "f5" && command));
    } else if (key === "f12" || (command && input.shift && key === "i")) {
      this.view.webContents.toggleDevTools();
    } else if (input.alt && key === "arrowleft") {
      this.back();
    } else if (input.alt && key === "arrowright") {
      this.forward();
    } else {
      return;
    }
    event.preventDefault();
  }
}
