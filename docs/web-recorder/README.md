# Writing Web Recorder scripts

The Web Recorder turns a script, a plain text file with one step per line, into a video of a web app. This guide
explains how to write one: the syntax, every command, how to point at elements on the page, and how to get a
video that is pleasant to watch.

Ready-to-adapt scripts are in [`examples/`](examples/). Open them in the tool with **Open...**.

- [Quick start](#quick-start)
- [Syntax](#syntax)
- [Targets: pointing at elements](#targets-pointing-at-elements)
- [Commands](#commands)
- [Timing](#timing)
- [Logging in](#logging-in)
- [Recipes](#recipes)
- [Tips for good presentation videos](#tips-for-good-presentation-videos)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

## Quick start

```
caption "Searching Wikipedia"
goto https://en.wikipedia.org
type input[name=search] "Electron (software framework)"
press Enter
wait-for #firstHeading
caption off
highlight #firstHeading
scroll down 800
wait 2s
```

1. Paste the script into the editor. Errors are shown below it as you type, with the line number marked in red.
2. Click **Test run** to play it with a live preview, without saving anything. Fix the steps that fail.
3. Click **Record**. The video is saved as an MP4 in the folder shown under **Save to**.

The video starts when the first page has finished loading, so it never shows a blank window. It ends one second
after the last step.

## Syntax

- **One command per line.** The command comes first, then its arguments, separated by spaces:
  `click #save`.
- **Command names are not case-sensitive:** `Click`, `CLICK` and `click` are the same.
- **Comments:** a line starting with `#` is ignored. Comments must be on their own line: in `click #save # the
  button`, the `# the button` part would be read as part of the target.
- **Blank lines** are ignored. Use them to group steps.
- **Quotes:** put an argument in double or single quotes when it contains spaces: `type #name "Ada Lovelace"`.
  Inside quotes, a backslash makes the next character literal: `"She said \"hi\""`. Use single quotes around text
  that contains double quotes, and the other way around: `click '[data-testid="save"]'`.
- **Durations:** `2s`, `1.5s`, `500ms`, or a plain number of seconds (`2`).
- **The script must open a page with `goto`** before any command that uses the page (`click`, `type`, `scroll`,
  ...). Only `caption`, `zoom` and `wait` can come before it.

### Dates relative to today

`{today}`, `{today-1}` and `{today+7}` become dates counted from the day the script runs, so a script that picks a
day or fills a date keeps working tomorrow. They work anywhere on a line, also inside quotes and selectors.

```
click [data-date="{today-1}"]
type #due "{today+7:dd/MM/yyyy}"
```

The default format is `2026-11-09` (`yyyy-MM-dd`). Another one goes after a colon, with `yyyy`, `MM`, `dd` (with a
leading zero), `M` and `d` (without). `HH` and `mm` are the hour and minute the script runs, for a value that must be
new on every run, such as the e-mail of a user the script creates:

```
type #email "user.{today:ddMMyyyyHHmm}@example.com"
```

## Targets: pointing at elements

Most commands act on an element of the page, called the *target*. A target is either a CSS selector or a text to
look for.

### CSS selectors

The same selectors as in a stylesheet or `document.querySelector()`:

| Selector | Matches |
| --- | --- |
| `#email` | the element with `id="email"` |
| `.btn-primary` | elements with the class `btn-primary` |
| `button.btn-primary` | `<button>` elements with that class |
| `input[name=search]` | the `<input>` whose `name` is `search` |
| `[data-testid="save-button"]` | the element with that test id |
| `nav a:nth-child(2)` | the second link in the navigation |
| `form .actions button` | a button inside `.actions` inside a form |

If several elements match, the first **visible** one is used, in the order they appear in the page. Hidden
elements (`display: none`, `visibility: hidden`, zero size, inside a closed menu) are skipped.

**Finding a selector:** open the app in Chrome or Edge, right-click the element, choose **Inspect**, then look at
its `id`, `name`, `data-*` attributes or classes. You can test a selector in the DevTools console with
`document.querySelector("your selector")`. Right-click > **Copy > Copy selector** also works, but its long
selectors break easily when the page changes.

Prefer selectors that do not change between releases: ids, `name` attributes and `data-testid` (or similar)
attributes. Avoid generated class names like `.css-1x2y3z` or `.Button_root__a8f3k`.

### Text

`text=` finds an element by what it says on screen:

```
click text=Sign in
click text=New project
hover text=Settings
```

- The comparison ignores upper and lower case and extra spaces.
- An element whose whole text is exactly the given text wins. If there is none, an element that *contains* the
  text is used: `text=Save` can match "Save changes".
- Besides visible text, it also matches `placeholder`, `aria-label`, `title` and `alt` attributes, and the labels
  of `<input type="button">` buttons. So `click text=Search` finds `<input placeholder="Search">`, and
  `click text=Close` finds an icon button with `aria-label="Close"`.
- When the text is inside a link or a button (e.g. `<button><span>Save</span></button>`), the link or button is
  used.

Text targets are easy to read and survive most page changes. They become ambiguous when the same text appears
several times; then use a CSS selector, or a longer, more specific text.

### Near another element: `A >> B`

When the same button appears several times, point at the one near something unique. `A >> B` finds B inside A or,
if A has none, inside the smallest block of the page around A that has one: an option of an open list, the Edit
button of the section titled "Address", the delete button of the row of "Ada Lovelace".

```
click text=Address >> text=Edit
click "[role=listbox] >> text=Brazil"
click text=Ada Lovelace >> [aria-label="Delete"]
type "text=Billing >> input[name=zip]" "01310-100"
```

Each side is a CSS selector or `text=`, and more parts can follow (`A >> B >> C`). Spaces around `>>` are required.

### Targets with spaces

For commands whose only argument is the target (`click`, `hover`, `scroll to`), quotes are optional:
`click text=Sign in` and `click form .actions button` work as written. For `type` and `select`, the text after the
target must be quoted, and the target before it may also be quoted: `type "#signup input[name=email]" "me@example.com"`.

### Waiting

Targets are waited for: when an element is not on the page yet (the page is still loading, a dialog is opening),
the command waits for it up to 10 seconds before failing. You rarely need `wait` just to let an element appear.

Elements outside the visible part of the page are scrolled to, smoothly, before the cursor moves to them.

## Commands

### `goto <url>`

Opens a page and waits for it to load (up to 30 seconds).

```
goto https://app.example.com/login
goto localhost:3000
goto 127.0.0.1:8080/dashboard
```

Without `http://` or `https://`, local addresses (`localhost`, `127.0.0.1`) get `http://` and others `https://`.
`open` is the same command.

### `follow <target>`

Opens the address of an element: the link it is or contains, or the address written in a field, such as the share
link of a document that the page shows in a read-only box. The cursor moves to it first.

```
follow input[readonly]
follow text=Public page
```

### `reload` / `reload hard`

Reloads the page, like pressing F5, and waits for it to load again. Use it when the app does not show new data by
itself, e.g. after something changed in another system or another tab, until the page is refreshed.

```
click text=Approve
goto localhost:3001/requests
reload
wait-for text=Approved
```

`reload hard` also skips the browser's cache, like Control+Shift+R: use it when a plain `reload` still shows old
data. The cursor, the caption and the zoom stay as they were. `refresh` is the same command.

### `click <target>`

Moves the cursor to the middle of the element and clicks it, with a click effect in the video. If the click opens
another page, the next step waits for it to load.

```
click text=New project
click #save
click "nav a[href='/reports']"
```

Links that would open a new tab open in the same page instead, so the video follows them.

An SVG line (a `path`, `line` or `polyline`, e.g. an arrow between two bars of a chart) is clicked on the line itself:
the middle of its box may be off a bent line or under something drawn over it, so the cursor goes to the first point
from the middle of the line out that is not covered.

### `hover <target>`

Moves the cursor over the element without clicking, for menus that open on hover, tooltips and hover effects.

```
hover text=Products
click text=Pricing
```

### `type <target> "text"` / `type "text"`

Clicks the field to focus it, then types the text one key at a time, at a human-like rhythm. Without a target, it
types into the element that already has the focus.

```
type #email "ada@example.com"
type text=Password "correct horse battery staple"
press Tab
type "second field, focused by Tab"
```

- The text is **added** to what the field already contains. To replace it, select the existing text first:
  `click #name`, `press Control+A` (`Meta+A` on macOS), then `type "new text"`.
- Any character can be typed, including accents and emoji.
- To press Enter, use `press Enter` on its own line. `\n` inside the quotes types the letter `n`.
- **Date and time fields** (`<input type="date">`, `time`, `datetime-local`, `month`, `week`) are filled at once with
  the value in the field's own format, instead of typed key by key (typing into them depends on the order of day and
  month of the browser's language): `type #due "{today+7}"` or `type #due "2026-11-30"` for a date, `"14:30"` for a
  time, `"2026-11-30T14:30"` for a date and time. The value replaces what the field had.

### `press <key>`

Presses a key or a combination, e.g. to submit a form, move between fields or use a shortcut of the app.

```
press Enter
press Tab
press Escape
press Control+K
press Shift+Tab
press Control+Shift+P
```

| Keys | Names |
| --- | --- |
| Editing | `Enter`, `Tab`, `Backspace`, `Delete`, `Space`, `Escape` (or `Esc`) |
| Navigation | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` (or `Up`, `Down`, `Left`, `Right`), `Home`, `End`, `PageUp`, `PageDown` |
| Function keys | `F1` to `F12` |
| Characters | any single character: `a`, `7`, `/`, `?` |
| Modifiers | `Control` (or `Ctrl`), `Shift`, `Alt` (or `Option`), `Meta` (or `Cmd`, `Command`), joined with `+` |

Key names are not case-sensitive. A press that opens another page waits for it like `click`.

### `select <target> "option"`

Chooses an option of a dropdown list (`<select>`), by its visible text or its value.

```
select #country "Brazil"
select text=Plan "Business"
```

The cursor moves to the list and shows a click, but the list does not open in the video, because the browser draws
those popups outside the page. Custom dropdowns built from regular elements (most UI libraries) are not `<select>`
lists: open them with `click` and choose with `click text=...`.

### `drag <target> to <target>` / `drag <target> by <x> <y>`

Presses the left button on the middle of an element, moves with the button down and releases, as real mouse events.
For bars of a chart, kanban cards, sliders and panning a canvas.

```
drag .card to #done
drag "[data-bar='1.2']" by 200 0
drag [data-resize] by -40 0
```

- `to` drops on the middle of another element, which must already be visible: use `scroll` first if it is not.
- `by` moves by that many pixels, right and down when positive.
- Elements that only appear on hover (like a resize handle) need a `hover` on their parent first.
- Quotes are optional, as in `click`. If the target itself contains the word `to` or `by`, it still works: the last
  one on the line is the separator.

### `upload [target] "file"`

Chooses files for a file field, without opening the file chooser (it would not appear in the video).

```
upload "photos/front.jpg"
upload input[name=avatar] "/home/me/avatar.png"
upload text=Choose photos "photos/a.jpg" "photos/b.jpg"
```

- Relative paths start from the folder of the saved script, so a script and its files can live together.
- The target is the file field, hidden or not, or a visible element next to it, such as its button or label. Then the
  cursor moves to it and shows a click.
- Without a target, the first file field of the page is used. With several files, write the target too, or the first
  quoted file would be read as the target.
- The field receives the change event, so the page reacts as if the files had been chosen by hand.

### `scroll`

```
scroll down
scroll down 800
scroll up 300
scroll right 400
scroll left 400
scroll to #pricing
scroll top
scroll bottom
```

`scroll down`, `up`, `left` and `right` scroll by the given number of pixels (500 without one), turning the mouse wheel where the cursor is, so a scrollable panel under the cursor
scrolls instead of the page. Move the cursor first (`hover`) to scroll a specific panel, such as a sidebar or a
table. `scroll to` scrolls the page
smoothly until the element is in the middle of the screen, and `scroll top` and `scroll bottom` to the start or
the end of the page.

### `wait <time>`

Pauses, e.g. to let the viewer read something or to let an animation finish. `pause` is the same command.

```
wait 2s
wait 500ms
```

### `wait-for <target> [timeout]`

Waits until an element appears, without moving the cursor, e.g. a result that takes time to load. The default
timeout is 10 seconds.

```
click text=Generate report
wait-for .report-ready 60s
```

`wait for` (two words) also works.

### `wait-until-gone <target> [timeout]`

Waits until nothing on the page matches the target, e.g. a loading overlay or a "Saving..." message that stays for a
variable time. The default timeout is 10 seconds; the script fails if the element is still there after it.

```
click text=Recalculate
wait-for text=Recalculating 10s
wait-until-gone text=Recalculating 120s
```

`wait-gone` also works.

### `highlight <target> [time]`

Draws attention to an element: the rest of the page is dimmed and the element is outlined for a moment (1.5 s by
default). The element is scrolled into view first.

```
highlight .revenue-chart 3s
highlight text=Total
```

### `if-visible <target> [timeout]` / `if-not-visible <target> [timeout]` / `end`

Runs the lines up to the matching `end` only if an element is on the page, or only if it is not. For things that
depend on the state of the app: a dialog that sometimes appears, an option remembered from a previous run.

```
if-visible text=Accept cookies 2s
  click text=Accept cookies
end

if-not-visible .chart 1s
  click text=Show chart
end
```

- Without a timeout the page is checked once, right away. Give one when the element may still be loading: unlike
  other commands, these do not wait 10 seconds. Both wait up to the timeout for the element to appear, so
  `if-not-visible` only runs its block after the whole timeout has passed.
- Hidden elements count as not visible.
- A condition that is not met is not an error: the script continues after the `end`.
- Blocks can be nested. Indentation is optional. There is no `else`: use the opposite command in a second block.

### `caption "text"` / `caption off`

Shows a subtitle at the bottom of the video. It stays, also across page changes, until the next `caption` or
`caption off`.

```
caption "1. Create a project"
click text=New project
# (the steps of part 1)
caption "2. Invite your team"
# (the steps of part 2)
caption off
```

Quotes are optional (`caption Create a project`). `caption none` and `caption clear` also hide it. A caption can
come before the first `goto`, to show it from the first frame.

### `zoom <percent>`

Zooms the page like Control and + in a browser, from 25% to 500%, to make small interfaces readable in the video.
It stays for the rest of the script, also on other pages.

```
zoom 125%
zoom 1.5
```

A plain number is a factor: `zoom 1.5` is the same as `zoom 150%`.

## Timing

You do not need to add pauses between every step:

- **After each visible step** (`goto`, `reload`, `click`, `hover`, `type`, `press`, `select`, `drag`, `upload`,
  `scroll`, `highlight`) the recorder pauses for 0.7 seconds, so viewers can follow. There is no pause after `wait`, `wait-for`, `caption`
  and `zoom`.
- **The cursor** glides to each element, faster for short distances (from about 0.25 s to 1.1 s).
- **Typing** takes about 75 ms per character, with a slightly irregular rhythm.
- **Pace** in the tool multiplies all of these: **Slow** ×1.6, **Normal** ×1, **Fast** ×0.55. `wait` times are
  not affected.

Add `wait` where the viewer needs time: after a caption appears, after something important changes on screen,
and at the end.

## Logging in

Recordings run in the recorder's own browser, which keeps its cookies between runs. To record an app that requires
logging in:

1. Make sure the script's first `goto` is the app's address.
2. Click **Log in...**. A window opens with that page, in the recorder's browser.
3. Log in as usual (passwords, two-factor codes, "remember me"), then click **Done** or close the window.
4. Record. The script starts already logged in, so it does not need login steps or your password.

The login lasts as long as the site keeps you logged in. **Clear saved logins** logs out of every site.

The window has a navigation bar like a browser: back, forward, **reload** and an address bar, to go to other
systems (e.g. after a single sign-on) or check that a page shows what you expect before recording. The usual
shortcuts work:

| Shortcut | Action |
| --- | --- |
| F5 or Control+R | reload |
| Control+Shift+R, Control+F5 or Shift+click on reload | reload without the cache |
| Alt+Left / Alt+Right | back / forward |
| F12 or Control+Shift+I | developer tools of the page (to inspect elements and find selectors) |

On macOS, use Command instead of Control.

You can also script the login, e.g. for a demo account. The password is then visible in the script and typed on
screen; with `type`, a password field shows dots in the video.

```
goto localhost:3000/login
type #email "demo@example.com"
type #password "demo-password"
click text=Sign in
wait-for .dashboard
```

Some sites, notably Google sign-in, refuse to log in from embedded browsers. Use another login method of the app,
or record a local or staging copy that does not need it.

## Recipes

### A form, field by field

```
click text=Add customer
wait-for #customer-form
type #name "Ada Lovelace"
press Tab
type "ada@example.com"
select #plan "Business"
click text=Save
wait-for text=Customer created
highlight text=Customer created
```

### A menu that opens on hover

```
hover text=Account
click text=Settings
```

### A menu that opens on click, then closing it

```
click [aria-label="Open menu"]
wait 1s
press Escape
```

### A search with results that load

```
type [placeholder="Search"] "invoices 2024"
press Enter
wait-for .results-list
highlight .results-list 2s
```

### Walking through a long page

```
scroll to #features
wait 1s
scroll to #pricing
highlight .plan-recommended 2s
scroll bottom
wait 1s
scroll top
```

### A command palette or shortcut

```
press Control+K
type "Create invoice"
press Enter
```

### Chapters with captions

```
caption "Step 1: connect your bank"
# (the steps of step 1)
caption "Step 2: categorize transactions"
# (the steps of step 2)
caption off
wait 1s
```

## Tips for good presentation videos

- **Test first.** Use **Test run** until the script runs without errors, then record.
- **Prepare the data.** Use a demo or staging account with realistic data, and reset it before each recording so
  steps that create things do not fail the second time.
- **Choose the resolution for the audience.** 1080p is a good default. Small interfaces are easier to read in
  720p, or with `zoom 125%`.
- **Guide the eye.** Use `caption` for what is happening and why, `highlight` for what matters on screen, and
  `hover` to point at things without clicking.
- **Let it breathe.** Add `wait 1s` or `wait 2s` after a caption appears and after important results. **Slow**
  pace suits tutorials, **Fast** suits short teasers.
- **Close distractions.** Cookie banners, "what's new" dialogs and chat widgets can cover what you click. Close
  them in the script (`click text=Accept`), or dismiss them once in **Log in...** so the site remembers.
- **Keep scripts in version control** next to the app, and use stable targets (ids, `data-testid`, visible
  texts), so the video can be recorded again after each release.

## Troubleshooting

**"Nothing on the page matches ..."**
- Test the selector in the DevTools console of a browser: `document.querySelector("...")`.
- The element may be hidden: open its menu, tab or dialog first with `click` or `hover`.
- The page may still be loading data: add `wait-for` with a longer timeout before the step.
- With `text=`, check the exact wording on screen (it may differ between languages or accounts).
- Elements inside iframes cannot be found (see [Limitations](#limitations)).

**The click hits the wrong element.**
- Several elements match, and the first visible one is used. Make the target more specific: a longer text, or a
  CSS selector that includes where the element is, like `#sidebar a[href="/reports"]`. (`text=` cannot be
  combined with a CSS selector.)
- Something covers the element (a banner, a toast, a sticky header): close it first, or `wait` until it
  disappears.

**The page shows a login screen.** The saved login expired or was never made: use **Log in...** again.

**Typing goes into the wrong field.** `type "text"` without a target types where the focus is. Give the target
explicitly: `type #email "..."`.

**Something happens too early.** After clicks that start an animation or a transition, add `wait 1s`, or
`wait-for` the element that appears at the end of it.

**The page shows old data until it is refreshed.** Some apps only load data when the page opens. Add `reload`
before the step that needs the new data, followed by `wait-for` the element that shows it. If it is still old,
use `reload hard`.

**"Unknown key ..."** Check the key names in [`press`](#press-key). Combinations are joined with `+` and no
spaces: `Control+Shift+P`.

## Limitations

- **No sound.** The page's audio is not recorded.
- **Iframes:** elements inside iframes (embedded videos, some payment forms and editors) cannot be targeted.
- **Native popups:** the open list of a `<select>`, date pickers drawn by the browser, and file choosers do not
  appear. `select` chooses an option without opening the list; `upload` sets the files without showing the chooser.
- **HTML5 drag and drop:** `drag` sends mouse events. Pages that drag with the native `draggable` attribute may not
  react to it; those built on mouse or pointer events do.
- **Dialogs:** `alert()`, `confirm()` and `prompt()` are accepted automatically and do not appear. "Leave this
  page?" prompts are skipped.
- **New tabs** open in the same page.
- **Protected video** (DRM, e.g. streaming services) appears black.
