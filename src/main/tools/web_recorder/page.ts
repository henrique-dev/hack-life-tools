// Functions run inside the recorded page with webContents.executeJavaScript().
// Each one is sent as its source text (fn.toString()), so it must not use
// anything defined outside its own body.
//
// The overlay avoids innerHTML and <style> elements so it also works on pages
// with a strict Content Security Policy or Trusted Types.

/** In CSS pixels of the page's viewport. */
export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FindResult = { rect: CssRect; inView: boolean } | { error: string } | null;

export interface OverlayState {
  /** Cursor position, CSS pixels. */
  x: number;
  y: number;
  cursor: boolean;
  caption: string | null;
}

/** Add the cursor, click effect, caption and highlight layer (once per page), then apply the state. */
export function installOverlay(state: OverlayState) {
  const w = window as any;
  if (!w.__hlt) {
    const host = document.createElement("hlt-overlay");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block";
    const root = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .cursor { position: absolute; left: 0; top: 0; width: 28px; height: 28px; margin: -3px 0 0 -5px;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); will-change: transform; }
      .ripple { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
        background: rgba(59,130,246,.3); border: 2px solid rgba(59,130,246,.85); animation: hlt-ripple .55s ease-out forwards; }
      @keyframes hlt-ripple { from { transform: scale(.2); opacity: 1 } to { transform: scale(1); opacity: 0 } }
      .spot { position: absolute; border-radius: 10px; box-shadow: 0 0 0 200vmax rgba(15,23,42,.5);
        outline: 3px solid #3b82f6; opacity: 0; transition: opacity .3s; }
      .caption { position: absolute; left: 50%; bottom: 6vh; transform: translateX(-50%); max-width: 80vw;
        padding: .45em 1em; border-radius: .5em; background: rgba(15,23,42,.88); color: #fff; text-align: center;
        font: 600 clamp(18px, 2.2vw, 44px)/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        white-space: pre-wrap; opacity: 0; transition: opacity .3s; }
      .shown { opacity: 1; }
    `);
    root.adoptedStyleSheets = [sheet];

    const make = (className: string) => {
      const element = document.createElement("div");
      element.className = className;
      root.append(element);
      return element;
    };
    const spot = make("spot");
    const caption = make("caption");
    const cursor = make("cursor");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "28");
    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute("d", "M4 2.5v17.2l4.6-4.4 3 6.8 3.1-1.4-3-6.7h6.3z");
    arrow.setAttribute("fill", "#fff");
    arrow.setAttribute("stroke", "#111");
    arrow.setAttribute("stroke-width", "1.5");
    arrow.setAttribute("stroke-linejoin", "round");
    svg.append(arrow);
    cursor.append(svg);

    let spotTimer: any = 0;
    const api = {
      cursorOn: true,
      // Some apps replace the whole document; put the overlay back.
      mount() {
        if (!host.isConnected) document.documentElement.append(host);
      },
      move(x: number, y: number) {
        api.mount();
        cursor.style.transform = `translate(${x}px, ${y}px)`;
        cursor.style.display = api.cursorOn ? "block" : "none";
      },
      ripple(x: number, y: number) {
        if (!api.cursorOn) return;
        api.mount();
        const ripple = document.createElement("div");
        ripple.className = "ripple";
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        root.insertBefore(ripple, cursor);
        setTimeout(() => ripple.remove(), 600);
      },
      caption(text: string | null) {
        api.mount();
        if (text) caption.textContent = text;
        caption.classList.toggle("shown", !!text);
      },
      highlight(rect: { x: number; y: number; width: number; height: number } | null, ms: number) {
        api.mount();
        clearTimeout(spotTimer);
        if (!rect) {
          spot.classList.remove("shown");
          return;
        }
        const pad = 8;
        spot.style.left = `${rect.x - pad}px`;
        spot.style.top = `${rect.y - pad}px`;
        spot.style.width = `${rect.width + 2 * pad}px`;
        spot.style.height = `${rect.height + 2 * pad}px`;
        spot.classList.add("shown");
        spotTimer = setTimeout(() => spot.classList.remove("shown"), ms);
      },
    };
    // The recorder moves the real mouse; the drawn cursor follows it.
    window.addEventListener("mousemove", (event) => api.move(event.clientX, event.clientY), true);
    window.addEventListener("mousedown", (event) => api.ripple(event.clientX, event.clientY), true);
    w.__hlt = api;
  }
  const api = w.__hlt;
  api.cursorOn = state.cursor;
  api.move(state.x, state.y);
  api.caption(state.caption);
}

/** Call a method of the overlay, if it is installed. */
export function overlay(method: string, args: unknown[]) {
  (window as any).__hlt?.[method]?.(...args);
}

/**
 * Find the first visible element matching a CSS selector or "text=...", remember it
 * for the next calls (targetRect, selectOption, ...) and return where it is.
 */
export function findTarget(selector: string): FindResult {
  const w = window as any;
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return (element as any).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  };
  let target: Element | null = null;

  if (/^text=/i.test(selector)) {
    const normalize = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = normalize(selector.slice(5));
    if (!wanted) return { error: "Write some text after text=." };
    const exact: Element[] = [];
    const partial: Element[] = [];
    const add = (element: Element | null, text: string | null | undefined) => {
      const normalized = normalize(text);
      if (element && normalized.includes(wanted)) (normalized === wanted ? exact : partial).push(element);
    };
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) add(parent, node.nodeValue);
    }
    for (const element of document.querySelectorAll(
      "input, textarea, button, select, [aria-label], [title], img[alt]",
    )) {
      for (const attribute of ["aria-label", "placeholder", "title", "alt"])
        add(element, element.getAttribute(attribute));
      if (element instanceof HTMLInputElement && /^(button|submit|reset)$/.test(element.type))
        add(element, element.value);
    }
    // Text split over several elements, e.g. "Sign <b>in</b>".
    if (!exact.length && !partial.length) {
      for (const element of document.querySelectorAll<HTMLElement>(
        "a, button, label, summary, [role], li, td, th, h1, h2, h3, h4, h5, h6, p, span, div",
      )) {
        if (normalize(element.innerText) === wanted) exact.push(element);
      }
    }
    const clickable =
      "a, button, input, textarea, select, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], " +
      "[role=option], [role=checkbox], [role=radio], [onclick]";
    const pick = (list: Element[]) => {
      for (const element of list) {
        const candidate = element.closest(clickable) ?? element;
        if (visible(candidate)) return candidate;
      }
      return null;
    };
    target = pick(exact) ?? pick(partial);
  } else {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { error: `"${selector}" is not a valid CSS selector. For text, write text=${selector}.` };
    }
    target = [...matches].find(visible) ?? null;
  }

  if (!target) return null;
  w.__hltTarget = target;
  const rect = target.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    inView: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
  };
}

export function scrollTargetIntoView() {
  (window as any).__hltTarget?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

/** Where the last found element is now, or null if it is gone. */
export function targetRect(): CssRect | null {
  const element: Element | undefined = (window as any).__hltTarget;
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Choose an option of the last found <select> by its text or value. Returns an error message, or null. */
export function selectOption(option: string): string | null {
  const element = (window as any).__hltTarget;
  if (!(element instanceof HTMLSelectElement)) return "The target is not a dropdown list (<select>).";
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = normalize(option);
  const options = [...element.options];
  const match =
    options.find((item) => normalize(item.label) === wanted || normalize(item.value) === wanted) ??
    options.find((item) => normalize(item.label).includes(wanted));
  if (!match) return `The list has no option "${option}".`;
  // The prototype's setter, so frameworks like React notice the change.
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, match.value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return null;
}

export function scrollToEdge(edge: "top" | "bottom") {
  const element = document.scrollingElement ?? document.documentElement;
  window.scrollTo({ top: edge === "top" ? 0 : element.scrollHeight, behavior: "smooth" });
}

export function scrollPosition() {
  return [window.scrollX, window.scrollY];
}
