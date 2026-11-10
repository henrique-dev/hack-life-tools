// The Web Recorder's script language and settings. Plain data and functions
// only, so the UI can import this module too (e.g. to show errors while typing).
//
// One command per line; blank lines and lines starting with # are ignored.
// Arguments are separated by spaces; quote them ("..." or '...') to include spaces.

export type Command =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "waitFor"; target: string; timeoutMs: number | null }
  | { kind: "click"; target: string }
  | { kind: "hover"; target: string }
  | { kind: "type"; target: string | null; text: string }
  | { kind: "press"; keys: string }
  | { kind: "select"; target: string; option: string }
  | { kind: "scroll"; by: number }
  | { kind: "scrollTo"; target: string }
  | { kind: "scrollEdge"; edge: "top" | "bottom" }
  | { kind: "highlight"; target: string; ms: number }
  | { kind: "caption"; text: string | null }
  | { kind: "zoom"; factor: number };

export interface Step {
  /** 1-based line number in the script. */
  line: number;
  source: string;
  command: Command;
}

export interface ScriptError {
  line: number;
  message: string;
}

export interface ParsedScript {
  steps: Step[];
  errors: ScriptError[];
}

export const DEFAULT_HIGHLIGHT_MS = 1500;
const DEFAULT_SCROLL = 500;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/** Commands that need a page, so they must come after the first goto. */
const PAGE_COMMANDS = new Set<Command["kind"]>([
  "waitFor",
  "click",
  "hover",
  "type",
  "press",
  "select",
  "scroll",
  "scrollTo",
  "scrollEdge",
  "highlight",
]);

/** For the help in the UI. */
export const COMMANDS: { syntax: string; description: string }[] = [
  { syntax: "goto <url>", description: "Open a page. Local apps work too: goto localhost:3000." },
  { syntax: "click <target>", description: "Move the cursor to the element and click it." },
  { syntax: "hover <target>", description: "Move the cursor over the element (shows menus and tooltips)." },
  { syntax: 'type <target> "text"', description: "Click a field and type into it, one key at a time." },
  { syntax: 'type "text"', description: "Type into the field that has the focus." },
  {
    syntax: "press <key>",
    description: "Enter, Tab, Escape, Backspace, ArrowDown, ..., or combinations like Control+A.",
  },
  { syntax: 'select <target> "option"', description: "Choose an option of a dropdown list, by its text." },
  {
    syntax: "scroll down|up [pixels]",
    description: `Scroll with the mouse wheel where the cursor is (default ${DEFAULT_SCROLL}).`,
  },
  { syntax: "scroll to <target>", description: "Scroll until the element is in the middle of the page." },
  { syntax: "scroll top|bottom", description: "Scroll to the top or the bottom of the page." },
  { syntax: "wait <time>", description: "Pause, e.g. wait 2s or wait 500ms." },
  { syntax: "wait-for <target> [timeout]", description: "Wait until the element appears (default timeout 10s)." },
  { syntax: "highlight <target> [time]", description: "Dim the page around the element for a moment (default 1.5s)." },
  { syntax: 'caption "text"', description: "Show a subtitle at the bottom of the video until the next caption." },
  { syntax: "caption off", description: "Hide the subtitle." },
  { syntax: "zoom <percent>", description: "Zoom the page, e.g. zoom 125%." },
];

export const TARGET_HELP =
  'A target is a CSS selector (#email, button.primary, [name="q"]) or text=... to find an element by its text ' +
  "(text=Sign in), which also matches placeholders and labels. Elements are waited for up to 10 seconds.";

export const EXAMPLE_SCRIPT = `# Lines starting with # are comments.
caption "Searching Wikipedia"
goto https://en.wikipedia.org
type input[name=search] "Electron (software framework)"
press Enter
wait-for #firstHeading
caption off
highlight #firstHeading
scroll down 800
wait 1s
scroll top
wait 2s
`;

// Settings of a recording, chosen in the UI.

export const RESOLUTIONS = {
  "1280x720": [1280, 720],
  "1920x1080": [1920, 1080],
  "2560x1440": [2560, 1440],
} as const;

export type Resolution = keyof typeof RESOLUTIONS;
export type Pace = "slow" | "normal" | "fast";

/** Multiplies the cursor movements, typing and pauses between steps. */
export const PACE_FACTOR: Record<Pace, number> = { slow: 1.6, normal: 1, fast: 0.55 };

export interface RecorderSettings {
  resolution: Resolution;
  fps: 30 | 60;
  pace: Pace;
  /** Draw a mouse cursor and click effects in the video. */
  cursor: boolean;
}

export const DEFAULT_SETTINGS: RecorderSettings = { resolution: "1920x1080", fps: 30, pace: "normal", cursor: true };

// Keys, as Chrome's DevTools protocol expects them (Input.dispatchKeyEvent).

export interface KeyPress {
  key: string;
  code: string;
  keyCode: number;
  /** Text the key types ("" for keys that type nothing, like Tab or Control+A). */
  text: string;
  /** Bit field: Alt 1, Control 2, Meta 4, Shift 8. */
  modifiers: number;
}

const MODIFIERS: Record<string, number> = {
  alt: 1,
  option: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

const NAMED_KEYS: Record<string, [key: string, code: string, keyCode: number, text?: string]> = {
  enter: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  space: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38],
  arrowdown: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37],
  arrowright: ["ArrowRight", "ArrowRight", 39],
  up: ["ArrowUp", "ArrowUp", 38],
  down: ["ArrowDown", "ArrowDown", 40],
  left: ["ArrowLeft", "ArrowLeft", 37],
  right: ["ArrowRight", "ArrowRight", 39],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, [`F${i + 1}`, `F${i + 1}`, 112 + i]] as const),
  ),
};

/** The key that types a character, or null if it has none (accents, emoji: those are inserted as text). */
export function charKey(char: string): KeyPress | null {
  if (/^[a-z]$/i.test(char)) {
    const upper = char.toUpperCase();
    return {
      key: char,
      code: `Key${upper}`,
      keyCode: upper.charCodeAt(0),
      text: char,
      modifiers: char === upper ? 8 : 0,
    };
  }
  if (/^[0-9]$/.test(char))
    return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char, modifiers: 0 };
  if (char === " ") return { key: " ", code: "Space", keyCode: 32, text: " ", modifiers: 0 };
  if (/^[\x21-\x7e]$/.test(char)) return { key: char, code: "", keyCode: 0, text: char, modifiers: 0 };
  return null;
}

/** Parse "Enter", "a" or "Control+Shift+K". Returns null if invalid. */
export function parseKeys(spec: string): KeyPress | null {
  const parts = spec.split("+");
  const last = parts.pop();
  if (!last) return null;
  let modifiers = 0;
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) return null;
    modifiers |= modifier;
  }
  const named = NAMED_KEYS[last.toLowerCase()];
  const press: KeyPress | null = named
    ? { key: named[0], code: named[1], keyCode: named[2], text: named[3] ?? "", modifiers: 0 }
    : [...last].length === 1
      ? charKey(last)
      : null;
  if (!press) return null;
  // Shortcuts type nothing; Shift types capitals.
  if (modifiers & 7) press.text = "";
  if (modifiers & 8 && /^[a-z]$/.test(press.key)) {
    press.key = press.key.toUpperCase();
    press.text = press.text && press.key;
  }
  press.modifiers |= modifiers;
  return press;
}

// Parsing.

interface Token {
  value: string;
  quoted: boolean;
}

function tokenize(line: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (/\s/.test(char)) {
      i++;
    } else if (char === '"' || char === "'") {
      let value = "";
      let closed = false;
      for (i++; i < line.length; i++) {
        if (line[i] === "\\" && i + 1 < line.length) value += line[++i];
        else if (line[i] === char) {
          closed = true;
          i++;
          break;
        } else value += line[i];
      }
      if (!closed) return "A quote is not closed.";
      tokens.push({ value, quoted: true });
    } else {
      let value = "";
      while (i < line.length && !/\s/.test(line[i])) value += line[i++];
      tokens.push({ value, quoted: false });
    }
  }
  return tokens;
}

/** "2s", "1.5s", "500ms" or "2" (seconds), in milliseconds. */
function parseDuration(token: Token | undefined): number | null {
  const match = token && !token.quoted && /^(\d+(?:\.\d+)?)(ms|s)?$/i.exec(token.value);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2]?.toLowerCase() === "ms" ? 1 : 1000));
}

/** Adds http:// for local addresses and https:// for others when the scheme is missing. */
function normalizeUrl(value: string): string | null {
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(value);
  const withScheme =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(about|data|file):/i.test(value)
      ? value
      : `${local ? "http" : "https"}://${value}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

const joined = (tokens: Token[]) => tokens.map((token) => token.value).join(" ");

/** Split off a trailing duration, e.g. "highlight .chart 3s". */
function withOptionalDuration(args: Token[]): [Token[], number | null] {
  if (args.length > 1) {
    const ms = parseDuration(args.at(-1));
    if (ms !== null) return [args.slice(0, -1), ms];
  }
  return [args, null];
}

function parseCommand(tokens: Token[]): Command | string {
  const name = tokens[0].value.toLowerCase();
  const args = tokens.slice(1);
  const needTarget = (list: Token[]) => (list.length ? joined(list) : null);

  switch (name) {
    case "goto":
    case "open": {
      if (args.length !== 1) return "Write the address after goto, e.g. goto https://example.com.";
      const url = normalizeUrl(args[0].value);
      return url ? { kind: "goto", url } : `"${args[0].value}" is not a valid address.`;
    }
    case "wait":
    case "pause": {
      if (args[0]?.value.toLowerCase() === "for")
        return parseCommand([{ value: "wait-for", quoted: false }, ...args.slice(1)]);
      const ms = parseDuration(args[0]);
      return ms !== null && args.length === 1
        ? { kind: "wait", ms }
        : "Write how long to wait, e.g. wait 2s or wait 500ms.";
    }
    case "wait-for":
    case "waitfor": {
      const [rest, timeoutMs] = withOptionalDuration(args);
      const target = needTarget(rest);
      return target ? { kind: "waitFor", target, timeoutMs } : "Write what to wait for, e.g. wait-for .results.";
    }
    case "click":
    case "hover": {
      const target = needTarget(args);
      return target ? { kind: name, target } : `Write what to ${name}, e.g. ${name} text=Sign in.`;
    }
    case "type": {
      const text = args.at(-1);
      if (!text?.quoted) return 'Put the text to type in quotes, e.g. type #email "me@example.com".';
      return { kind: "type", target: needTarget(args.slice(0, -1)), text: text.value };
    }
    case "press": {
      if (args.length !== 1) return "Write one key or combination, e.g. press Enter or press Control+A.";
      return parseKeys(args[0].value) ? { kind: "press", keys: args[0].value } : `Unknown key "${args[0].value}".`;
    }
    case "select": {
      const option = args.at(-1);
      const target = needTarget(args.slice(0, -1));
      if (!option?.quoted || !target) return 'Write the list and the option in quotes, e.g. select #country "Brazil".';
      return { kind: "select", target, option: option.value };
    }
    case "scroll": {
      const how = args[0]?.value.toLowerCase();
      if (how === "down" || how === "up") {
        const amount = args[1] ? Number(args[1].value.replace(/px$/i, "")) : DEFAULT_SCROLL;
        if (!(amount > 0) || args.length > 2) return "Write how many pixels to scroll, e.g. scroll down 600.";
        return { kind: "scroll", by: how === "down" ? amount : -amount };
      }
      if ((how === "top" || how === "bottom") && args.length === 1) return { kind: "scrollEdge", edge: how };
      if (how === "to") {
        const target = needTarget(args.slice(1));
        return target ? { kind: "scrollTo", target } : "Write where to scroll to, e.g. scroll to #pricing.";
      }
      return "Use scroll down, scroll up, scroll to <target>, scroll top or scroll bottom.";
    }
    case "highlight": {
      const [rest, ms] = withOptionalDuration(args);
      const target = needTarget(rest);
      return target
        ? { kind: "highlight", target, ms: ms ?? DEFAULT_HIGHLIGHT_MS }
        : "Write what to highlight, e.g. highlight .chart 2s.";
    }
    case "caption": {
      if (args.length === 1 && !args[0].quoted && /^(off|none|clear)$/i.test(args[0].value))
        return { kind: "caption", text: null };
      if (!args.length) return 'Write the caption in quotes, e.g. caption "Creating a project", or caption off.';
      return { kind: "caption", text: joined(args) };
    }
    case "zoom": {
      const match = args.length === 1 && /^(\d+(?:\.\d+)?)(%?)$/.exec(args[0].value);
      const factor = match ? Number(match[1]) / (match[2] ? 100 : 1) : NaN;
      if (!(factor >= MIN_ZOOM && factor <= MAX_ZOOM)) return "Write the zoom in percent, e.g. zoom 125%.";
      return { kind: "zoom", factor };
    }
    default:
      return `Unknown command "${tokens[0].value}".`;
  }
}

export function parseScript(text: string): ParsedScript {
  const steps: Step[] = [];
  const errors: ScriptError[] = [];
  let opened = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const source = raw.trim();
    const line = index + 1;
    if (!source || source.startsWith("#")) return;
    const tokens = tokenize(source);
    if (typeof tokens === "string") {
      errors.push({ line, message: tokens });
      return;
    }
    const command = parseCommand(tokens);
    if (typeof command === "string") {
      errors.push({ line, message: command });
      return;
    }
    if (command.kind === "goto") opened = true;
    else if (!opened && PAGE_COMMANDS.has(command.kind)) {
      errors.push({ line, message: "Open a page with goto before this line." });
      return;
    }
    steps.push({ line, source, command });
  });

  if (!errors.length && !opened) errors.push({ line: 1, message: "The script needs a goto line to open a page." });
  return { steps, errors };
}
