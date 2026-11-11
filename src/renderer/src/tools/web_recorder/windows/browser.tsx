import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { callTool, errorMessage, onToolEvent } from "../../../api";
import { BROWSER_TOOLBAR_HEIGHT, type BrowserState } from "../../../../../main/tools/web_recorder/script";

const TOOL_ID = "web_recorder";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  back: "M19 12H5M12 19l-7-7 7-7",
  forward: "M5 12h14M12 5l7 7-7 7",
  reload: "M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5",
  stop: "M18 6 6 18M6 6l12 12",
};

function ToolbarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

/**
 * Navigation bar of the Web Recorder's login window. The page itself is drawn
 * by the main process below this bar (see src/main/tools/web_recorder/browser.ts).
 */
export default function BrowserToolbar() {
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    const show = (next: BrowserState | null) => {
      setState(next);
      // Do not replace what the user is typing.
      if (next && !editing.current) setAddress(next.url);
    };
    call<BrowserState | null>("browserState")
      .then(show)
      .catch(() => {});
    return onToolEvent(TOOL_ID, "browser", (payload) => show(payload as BrowserState));
  }, []);

  const run = (method: string, ...args: unknown[]) => {
    setError(null);
    call(method, ...args).catch((err) => setError(errorMessage(err)));
  };

  return (
    <div
      className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
      style={{ height: BROWSER_TOOLBAR_HEIGHT }}
    >
      <ToolbarButton title="Back (Alt+Left)" disabled={!state?.canGoBack} onClick={() => run("browserBack")}>
        <Icon path={ICONS.back} />
      </ToolbarButton>
      <ToolbarButton title="Forward (Alt+Right)" disabled={!state?.canGoForward} onClick={() => run("browserForward")}>
        <Icon path={ICONS.forward} />
      </ToolbarButton>
      {state?.loading ? (
        <ToolbarButton title="Stop" onClick={() => run("browserStop")}>
          <Icon path={ICONS.stop} />
        </ToolbarButton>
      ) : (
        <ToolbarButton
          title="Reload (F5). Shift+click or Control+Shift+R: reload without the cache"
          disabled={!state}
          onClick={(event) => run("browserReload", event.shiftKey)}
        >
          <Icon path={ICONS.reload} />
        </ToolbarButton>
      )}
      <form
        className="ml-1 min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          editing.current = false;
          (document.activeElement as HTMLElement | null)?.blur();
          run("browserNavigate", address);
        }}
      >
        <input
          value={address}
          spellCheck={false}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => {
            editing.current = true;
            event.target.select();
          }}
          onBlur={() => {
            editing.current = false;
            if (state) setAddress(state.url);
          }}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
          title={error ?? undefined}
          className={`h-8 w-full rounded-full border bg-white px-4 text-sm outline-none focus:border-blue-500 dark:bg-gray-950 ${
            error ? "border-red-500" : "border-gray-300 dark:border-gray-700"
          }`}
        />
      </form>
      <button
        type="button"
        title="Close this window. Logins stay saved for the recordings."
        onClick={() => window.close()}
        className="ml-1 shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Done
      </button>
    </div>
  );
}
