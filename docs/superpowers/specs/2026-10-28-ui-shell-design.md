# Pitwall: Sub-project 2 "UI shell", Design

Status: draft for user review · Date: 2026-10-28 · Brainstorm: session 1 in `docs/brainstorms/2026-10-28-ui-shell.md` (visual system, shell decisions), session 2 in conversation (code structure, this document)

## 1. Context

### 1.1 What this sub-project is for
The foundation (sub-project 1 plus the groundwork fixes) delivers typed topics over a WebSocket. Sub-project 2 builds the UI that every later display plugs into. Its main goal is **expandability**: adding or changing a display, a calculation or (later) a simulator must be cheap and easy to find.

The working model behind that goal (user, 2026-10-28):
- **One agent or person per display, with no interaction between them.**
- **Shared calculations are built before the displays that use them.** A display agent only reads their topics and never edits them.

### 1.2 Goals
The ranked goals of the foundation spec (1.2) apply unchanged: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

### 1.3 Decisions this spec builds on
- **Session 1 of the brainstorm** (`docs/brainstorms/2026-10-28-ui-shell.md`):
  - section 1, the visual system: grey by default, colour only to highlight or distinguish, JetBrains Mono everywhere, fixed type, value states
  - section 3, the shell decisions: stable layout, manual workbook switching, windows, link groups, fixed top bar, alerts, UI state in the bridge

  This spec gives those decisions their code shape and does not reopen them.
- **Research 06** (`docs/research/06-engineer-decisions.md`): numbers only, no verdicts; realism mode; the display catalogue V01–V35; the escalation map and the race moment; the game's pit window is not shown.
- **Groundwork** (on main): one file per topic (ADR 0007), typed `bind*` helpers, jobs with `Computed<T>`, read-only calculator config with session sidecars (ADR 0008), the UI decides staleness from `CarState.updatedAt` (Q-D), the second car later (ADR 0009).

## 2. Scope

**In scope:**
1. The **extension model**: analyses and displays, naming, ownership, write scopes (section 3).
2. The **display contract**: `defineWidget` and what the shell does for every widget (section 4).
3. The **UI kit**: value cell, dense table, chart, canvas surface, size primitive, theme, emphasis helpers (section 5).
4. The **data path** in the UI: connection, topic store, folds, staleness, `Computed` results (section 6).
5. The **shell**: windows with the Electron host, workbooks, docking, link groups, top bar, alerts, commands and keys, realism switch, UI state in the bridge (section 7).
6. **Findability and the dev loop**: catalogue, `pitwall where`, dev inspector, `pitwall dev` with feature reload and replay transport (section 8).
7. **Gallery and tests**: named moments, gallery, fit and screenshot tests (section 9).
8. **One placeholder display** (feed and session status) that proves the path end to end.

**Out of scope:**
- every real analysis and display (sub-projects 3 and 4)
- the default race layout (it follows from the displays of sub-projects 3 and 4)
- simulators and what-if requests: only their shape is reserved (6.6)
- configurable generic displays (ATLAS-style channel tables and charts): no part of this design may prevent them
- the in-app key rebinding menu (later, writes the same file as 7.7)
- the second car: no part of this design may assume a single feed

## 3. Extension model

### 3.1 Two kinds of units
Displays and calculations are many-to-many: the rejoin projection feeds V01, V03, V15 and V18, and the timing tower reads several topics. The **topic** is the seam between them.

| Unit | What it is | Folders | Built |
|---|---|---|---|
| **Analysis** | a shared calculation that publishes topics: degradation, pit loss, gaps, rejoin, the optimiser, the race moment | `packages/strategy/src/<name>/` (pure maths, when there is any), `apps/bridge/src/features/<name>/` (wiring: calculators, jobs, config, bindings), its topic files | before the displays that read it |
| **Display** | one widget, plus calculations and topics that only it uses | `apps/ui/src/widgets/<name>/`, optionally `apps/bridge/src/features/<name>/` and `packages/strategy/src/<name>/` with the same name, its topic files | one agent each, no interaction |

- A **unit name** is kebab-case and unique across analyses and displays, e.g. `rejoin`, `undercut-card`.
- A bridge feature folder whose name matches a widget folder is **private to that display**. Every other feature folder is an analysis.

### 3.2 Topic names and owners
- `defineTopic` gains an `owner` field: `defineTopic<P, V>({ owner, mode, maxHz })`. `owner` is a unit name or `'core'`.
- The topic name's first segment is the owner's name in camelCase: unit `undercut-card` owns `undercutCard.rows`; unit `rejoin` owns `rejoin.projection`. This keeps the existing topic-name rule (`/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/`).
- The 11 foundation topics, the `ui.*` topics (7.8) and the `dev.*` topics (8.3) have owner `'core'` and are exempt from the prefix rule.
- **Reading rules:** an analysis topic may be read by any widget. A display's private topic may be read only by its own widget. The catalogue check enforces both (8.1).

### 3.3 Ownership and write scopes
- **A worker owns everything named after its unit:** the folders in 3.1 and the topic files `packages/contracts/src/topics/<camelName>.*.ts`.
- **The supervisor still owns everything shared:**
  - `packages/domain`
  - everything in `packages/contracts` except unit-owned topic files
  - the UI kit (`apps/ui/src/kit`, `theme`, `emphasis`), the shell, `connection`
  - the files supervisor-owned today
  A worker who needs a change there lists it under "Requested changes to supervisor-owned files", as now.
- **Guard extension:** `PITWALL_WORKER_UNIT=<name>` grants the unit's folders and topic files in addition to `PITWALL_WORKER_SCOPE`. `guard-scope.sh` lets a unit-owned topic file through its `packages/contracts/*` block. CLAUDE.md's ownership list is updated to match.
- **Display agents never edit an analysis.** A needed change goes into the report as a request to the analysis owner.

## 4. Display contract

### 4.1 Folder
`apps/ui/src/widgets/<name>/`:

| File | Content |
|---|---|
| `widget.ts` | `export const widget = declareWidget({ … })`: name, title, data, options, sizes (4.2) |
| `register.ts` | `export default registerWidget(widget, () => import('./<Name>.svelte'))`; the component imports its prop types from `widget.ts`, so there is no import cycle |
| `<Name>.svelte` | the component. It renders; it does not fetch, subscribe or measure. |
| `emphasis.ts` | pure functions from states in topic values to theme roles; no colour literals |
| `gallery.ts` | gallery cases (9.1); imported only by the gallery |
| `*.test.ts` | emphasis tests and anything else the display needs |

A generated index (`apps/ui/src/widgets/index.generated.ts`, gitignored, from `scripts/gen-widgets.ts`, part of `pnpm gen`) collects the `register.ts` files, as ADR 0005 does for features. The `name` in `declareWidget` must equal the folder name. Below, `defineWidget` means the pair `declareWidget` + `registerWidget`.

### 4.2 `defineWidget`
```ts
// apps/ui/src/widgets/undercut-card/register.ts
export default defineWidget({
  name: 'undercut-card',
  title: 'Undercut',
  data: {
    rows: topic('undercutCard.rows', ({ link }) => ({ carId: link.primary })),
    laps: folded('laps', currentLaps),
    session: optional(topic('session.info')),
  },
  options: {
    reference: choiceOption(['ahead', 'behind', 'both'], 'both', 'Neighbours'),
  },
  sizes: { compact: { minCols: 28, minRows: 4 }, full: { minCols: 60, minRows: 8 } },
  component: () => import('./UndercutCard.svelte'),
});
```
- **`data`** is static: every entry names its topic, so the catalogue and the inspector can read it without running anything.
  - `topic(name, params?)` for state topics. `params` is a function of `{ link, options }` and returns `TopicParams<name>`.
  - `folded(name, fold, params?)` for append topics. The fold comes from `domain` (`currentLaps` and the like) or the kit, so bridge and UI resolve history the same way. A widget never sees raw `append` messages.
  - `optional(…)` marks a topic the widget can render without. It arrives as `undefined` until it has data. Every other topic is required.
  - A `Computed<T>` topic arrives as value plus `computedFor`.
- **`options`** are per-panel settings, UI-only. The kit offers `boolOption`, `choiceOption`, `numberOption` and `carOption`. Values are saved per panel in the workbook. Anything a calculation needs goes into topic params or feature config, never into options.
- **`sizes`** are size modes in **character cells** (4.4). The shell picks the largest mode that fits.
- **`component`** is loaded lazily. Node can then import every `register.ts` without Svelte, and the app splits its code per widget.
- **Types:** the component's props are derived from the declaration: `data` (each value typed `TopicValue<T>`, or the fold's result, `| undefined` when optional), `options`, `size`, `link`. A wrong topic name, wrong params or an undeclared option is a compile error.

### 4.3 What the shell does for every widget
- subscribes to the declared topics with params worked out from the panel's link group and options, and resubscribes when they change
- folds append topics through the declared fold
- renders the component only once every required topic has a value
- handles every widget-level state in the **panel header**, the same way for every widget:
  - `no data yet`
  - `errored`: one sentence instead of numbers, red header, never old or invented numbers
  - `stale N s`: values stay but dim (6.4)
  - the age of a `Computed` result (`L23`)
- passes the size (4.4)
- builds the settings popover from `options`

### 4.4 Size in character cells
- One monospace font (JetBrains Mono, ligatures off) at **one size per window**: the theme's default is 14 px, and each window can be made bigger or smaller (`Ctrl+=` / `Ctrl+-`, saved as the window's `fontPx` in the workbook), e.g. for the 14" monitor (user, Task 0). Everything in a window, headers and top bar included, uses that one size. A cell is exactly 0.6 em wide and one line high.
- The component gets `size = { mode, cols, rows, px: { width, height }, dpr }`. Text widgets lay out in `cols × rows`; chart and canvas widgets use `px` and `dpr`.
- **Fields drop by priority:** the kit's table takes a priority and a width in cells per column and drops the least important columns first. "Tyre age needs 3 columns, drop it below 40" is arithmetic.
- Charts use extra space for more history, not for thicker lines or bigger text.
- Changing the font size in the theme changes how many cells fit, never the layout rules.
- One shared size primitive (`kit/size/`: `ResizeObserver`, device pixel ratio, minimum size) measures every panel. Widgets never measure themselves.

### 4.5 Rules
- **Widgets never import each other** and never talk to each other.
- **Widgets cannot change the link group.** Only the shell's group picker and keys change it (7.5). A click inside a widget stays inside that widget, at most as a local highlight.
- **Condition emphasis comes from analyses.** A topic value carries the state next to the number, e.g. `{ temp: Known<Celsius>, band: 'low' | 'in' | 'high' }`. The widget's `emphasis.ts` maps the state to a theme role. Thresholds live only in bridge feature config, which is saved with each session, so a replay lights up exactly what lit up live.
- **Convention emphasis** (purple overall best, green personal best, flag colours) uses the kit's pure functions in `emphasis/`.
- **Numbers only, no verdicts** (research 06 §5): no widget shows "BOX" or "undercut works", only the computed numbers.
- Widgets bind no keys in the MVP.

### 4.6 Enforced
- **dependency-cruiser:**
  - `widgets/*` imports only `kit`, `theme` (role types), `emphasis`, `@pitwall/contracts`, `@pitwall/domain` and its own folder
  - `kit` imports only `theme`, `emphasis`, `contracts`, `domain`
  - `connection` imports only `contracts`, `domain`
  - only `shell` imports the generated widget index
  - only `gallery` imports `gallery.ts` files
  - only `shell/docking` imports dockview-core
- **ESLint:**
  - no colour literals outside `theme/`
  - no font family other than the theme's
  - no `WebSocket` or `fetch` outside `connection/`
  - no `window.*` host calls outside `shell/host/`

## 5. UI kit
`apps/ui/src/kit/`, supervisor-owned. It has to be rich enough that no display agent invents its own table or value rendering. Its exact look is settled by mockups the user approves before implementation (session 1: "many mockups before code").

| Part | What it does |
|---|---|
| `values/` | **The value cell:** renders any `Known` value with its unit and format, following the session 1 value states: unknown or hidden → empty cell with the reason on hover (including `realism`); estimated → `~` and dimmer grey; inactive car → dim row; stale → dim (6.4). Also formatters per unit (ms → `1:23.456`, gaps, °C, psi, kg) in one module, `values/format.ts`: widgets must format through it (lint-enforced), so a format changes in one place. |
| `table/` | **Dense table:** columns with width in cells and priority, field dropping, row banding by lightness, inactive rows kept at the bottom, local row highlight |
| `chart/` | **Time or lap chart** on uPlot: series with distinction colours from the theme, SC/VSC background bands, per-series freshness |
| `canvas/` | **Canvas surface:** size and dpr handling, a draw callback, marks with freshness (dimmed by the kit, not by the widget) |
| `size/` | the size primitive (4.4) |
| `define-widget.ts` | `defineWidget`, `topic`, `folded`, `optional`, the option helpers |

`apps/ui/src/theme/`: semantic roles to values, theme variants switchable at runtime, the font and its default size, and the **density tokens** (line height, panel gap, column gap, header padding). It's the only place colour and spacing values exist. Widgets set no margins, padding, gaps or line heights of their own; the kit's components own spacing. The user found the mockups very dense and wants to judge density once real displays exist (Task 0), so density must stay a one-place change.
`apps/ui/src/emphasis/`: pure convention-emphasis functions; no Svelte; unit- and mutation-tested.

## 6. Data path

### 6.1 Connection (`apps/ui/src/connection/`)
- **One connection per window.** Each window is its own client.
- On `hello`, it checks `contractVersion`. A mismatch shows "bridge updated, reload" and reloads.
- On disconnect it reconnects with backoff (immediately in dev builds), resubscribes everything and gets fresh snapshots. Meanwhile every panel shows `stale`.
- It's the only module that touches the WebSocket.

### 6.2 Topic store
- Keyed by `(feedId, topic, params)` and reference-counted: two panels with the same topic and params share one subscription; the last one closing unsubscribes.
- State topics hold the latest value; append topics hold their fold's result.
- Typed by topic name: `TopicParams<T>` in, `TopicValue<T>` out. Values from the bridge are trusted, so there's no validation beyond the wire decoder.
- Reactive through Svelte 5 runes. The shell reads it; widgets only get props.
- **Session clock:** the newest session time per feed. That's "now" for staleness and the top bar.

### 6.3 Feeds
`feedId` is part of every store key and every link group (7.5) from day one. The MVP has one feed, but the second car later is one more feed, not a rewrite.

### 6.4 Staleness
The UI decides staleness (Q-D), and no widget author writes it.
1. **Connection and feed level, automatic:** the connection being down, or `feed.status.stale`, makes every panel of that feed stale.
2. **Car fields, automatic:** the kit holds one static map from `CarState` field to data source (`tyres.surfaceTemp → telemetry`, `tyres.wear → damage`, …). A value cell rendering a car field compares the source's `updatedAt` with `SOURCE_INTERVAL_MS` and `feed.status.cadenceMs`, and dims when about three updates have been missed.
3. **Analysis topics:** no per-value staleness. They're as fresh as the feed; `Computed` results show their age in the header.

Value cells, and the kit's chart and canvas marks, report their staleness to the panel through Svelte context. The panel header then shows `stale N s` once. A widget that draws its own marks passes the freshness the kit gives it to the kit's mark primitives; how stale looks is decided by the kit, never by a widget.

### 6.5 The placeholder display
`widgets/feed-status/` reads `feed.status` and `session.info`. It shows connection, loss, packets per second, latency, wrong format, session type and state, track and the player's car. It exists to prove the full path: connection, store, panel states, size modes, gallery, screenshots.

### 6.6 Reserved: what-if requests
Not built. A what-if is a **parameterised subscription** to a simulator topic, e.g. `topic('optimiser.scenario', () => ({ boxLap: 24, compound: 'hard' }))`. That needs no new message type. The bridge would run the job per parameter set and publish `Computed<T>`. Nothing in sections 4–6 may prevent it: params are already part of the store key and of `topic()`.

## 7. Shell (`apps/ui/src/shell/`)

### 7.1 Host and windows
- **Electron is the daily host; the UI stays a plain web app.** `apps/ui` contains no Electron API. Everything host-specific goes through `shell/host/`:
  ```ts
  type Host = {
    kind: 'electron' | 'browser';
    ensureWindows(windows: WindowSpec[]): void; // open, close and place windows
    onGeometryChange(cb: (id: WindowId, g: Geometry) => void): void;
    openPath(path: string): void; // dev inspector
  };
  ```
  - `electronHost`: talks to the main process through the preload bridge `window.pitwallHost`.
  - `browserHost`: windows are tabs opened as `/?window=<id>`. `ensureWindows` only lists the missing ones for the user to open. Geometry is reported, but placing is best effort.
- **`apps/desktop`** is the Electron app:
  - **main process:** a thin window manager. It opens, closes and places native windows on `ensureWindows`, and reports geometry changes. It blocks browser shortcuts (`Ctrl+W`, `Ctrl+R`, `F5`, back and forward) except in dev builds. It starts the bridge as a child process (`pitwall live`, ports from env) or attaches to a running one. It holds no UI state.
  - **preload:** exposes `window.pitwallHost`, with context isolation on and no Node integration in windows.
  - It imports nothing from the workspace; it loads the built UI, or the Vite dev server in dev.
  - Electron's Chromium is the Chromium the screenshot tests pin (9.3).
- **Windows.** A window is one per monitor (`strategy`, `car`, …), with an id from the workbook.
  - The shell of the workbook's first window calls `ensureWindows` when the active workbook changes.
  - Every window reports geometry changes, which go into the workbook (7.2).
  - A window id the workbook doesn't know opens empty, with a widget picker.
  - Panels can be dragged between windows.
  - Tauri is rejected: on Linux it renders with WebKitGTK, which is slower for canvas and renders differently from Chromium.

### 7.2 Workbooks
- A workbook is one hand-editable JSON file, `PITWALL_DATA_DIR/ui/workbooks/<name>.json`:
  ```jsonc
  {
    "name": "race",
    "windows": [
      { "id": "strategy", "geometry": { "screen": 0, "x": 0, "y": 0, "width": 1920, "height": 1080 },
        "layout": { /* dockview serialised layout */ },
        "panels": { "p1": { "widget": "feed-status", "options": {}, "linkGroup": 1 } } }
    ]
  }
  ```
- A panel names the link group it follows. The groups themselves (7.5) are runtime selections, not layout, so they live in `PITWALL_DATA_DIR/ui/state.json` and are the same in every workbook.
- **Read leniently,** like the config sidecars (ADR 0008): an unknown widget becomes a panel saying "unknown widget `x`"; an invalid or unknown option falls back to its default with a note; a broken layout falls back to an empty window. Invalid JSON is an error shown in the shell, and the previous workbook stays active.
- **Saved automatically:** layout, panel, option and geometry changes are saved to the active workbook, debounced.
- **Hand edits are never overwritten.** The bridge watches `PITWALL_DATA_DIR/ui/workbooks/`:
  - A changed file that the bridge didn't write itself (it compares a content hash) is re-read at once. If it's the active workbook, every window switches to the edited version.
  - If the edited active workbook is invalid JSON, the shell shows the error and keeps the last good version, and autosave pauses until the file is valid again. A half-finished hand edit is never written over.
- **Switching is manual only:** `Ctrl+1…9` plus a picker. There's no automatic switch at session change.

### 7.3 Docking
A thin adapter over dockview-core in `shell/docking/`. Nothing else imports dockview. Panels carry their widget name, options and link group; the adapter maps dockview's events to workbook changes.

### 7.4 Panel frame
`shell/panel/` renders every panel the same way (Task 0 option B): a header **band** in `bgBand` with no rule and no outer border, holding the title, the link-group marker (`1`, or `1 · HAM` in white when the primary isn't the default; the car is never repeated in the title), the states from 4.3 and a gear icon (an SVG in the kit, since JetBrains Mono has no gear glyph) for settings; then the widget body, sized by the size primitive.

### 7.5 Link groups
- Numbered, not coloured. A group holds a `feedId`, a primary car (default: the player), compare cars and a time window (live, one lap, or a lap range).
- **Only the shell changes a group:** the group picker in the panel header or the top bar, and keys (`linkGroup.<n>.pickPrimary`, `linkGroup.<n>.resetPrimary`, …). Widgets only read groups (4.5). A comparison takes about two clicks in the picker.
- `"player"` and `"teammate"` in a workbook resolve to car ids through `session.info`; a widget always gets a resolved `CarId` in `link.primary`.
- Group 1 is the default for every new panel, so out of the box it acts like one global selection.

### 7.6 Top bar
Fixed, not dockable, in every window:
- session, lap, clock, flag
- the race moment (`race.moment`, optional: nothing produces it until sub-project 3 or 4)
- feed health
- realism state (7.9)
- the replay transport when the feed is a replay (8.5)
- the unacknowledged tier-1 alerts (7.7)

The incident feed (V35, research 06) stays a normal display. Incidents serious enough for us become tier-1 alerts and appear in the top bar anyway.

### 7.7 Alerts, commands and keys
- **Alerts** come from bridge insights:
  - `critical` insights are **tier 1**: listed in the top bar until acknowledged, one at a time or all with one key
  - `advisory` and `info` insights are for displays such as the alarm list (V25, later)
  - the insight `category` is the alert group; groups can be muted
  - a widget's own highlight stays while its condition holds, whatever the alert state (4.5)
  - sound comes later
- **Commands:** every shell action is a named command in one registry (`shell/commands/`), e.g. `workbook.open.3`, `alerts.ackAll`, `alerts.ack`, `linkGroup.1.resetPrimary`, `window.focus.car`, `realism.toggle`, `replay.pause`, `dev.inspect`.
  - **The command palette** (`Ctrl+K`) finds and runs any command and shows its key.
  - **The key overview** (`?`) lists every binding, grouped.
  - Later input devices (Stream Deck, button box) map to the same command ids.
- **Keys:** default bindings plus `PITWALL_DATA_DIR/ui/keys.json` (`{ "<key>": "<command id>" }`), read leniently: an unknown command or a conflicting key is ignored, with a note in the key overview. Only the shell binds keys. The in-app rebinding menu comes later and writes the same file.

### 7.8 UI state in the bridge
The bridge owns UI state, so every window shows the same state and it survives restarts:
- **Topics** (owner `core`). They belong to no feed, so `defineTopic` gains `scope: 'feed' | 'global'` (default `'feed'`); the hub keeps global topics apart from the feeds, and a subscription to a global topic skips feed resolution.
  - `ui.workbooks`: the list of workbook names, the active name and its content
  - `ui.linkGroups`
  - `ui.alerts`: acknowledged keys, muted groups
  - `ui.settings`: the realism value for the next session (7.9) and the effective key bindings from `keys.json` (7.7), since the UI cannot read files itself
- **One new client message,** `{ type: 'uiAction', id, action: UiAction }`:
  - `UiAction` is a union: `workbook.open`, `workbook.update` (a patch from the shell), `workbook.saveAs`, `linkGroup.set`, `alert.ack`, `alert.ackAll`, `alertGroup.mute`, `realism.set`
  - an invalid action gets `error { id, reason: 'malformed' }`
- **Saved** in `PITWALL_DATA_DIR/ui/` (workbooks, `state.json` for link groups and alert state).
- These are `contracts` changes (supervisor-owned) and bump `CONTRACT_VERSION`.

### 7.9 Realism mode
- **Set between sessions, not during one** (user, 2026-10-28). The top bar shows the current session's value and, if different, the value pending for the next session. `realism.set` writes it to the bridge config. The bridge applies it when the next session starts and saves it in that session's config sidecar, so replays reproduce it.
- **Effect:** with realism on, rival cars' wear, damage, fuel, ERS, tyre sets, temperatures, pressures, driver inputs and car telemetry become `unknown('realism')` in engine state, before any calculator sees them. An engine sub-step after `applyOwnCar` sets them, like `withholdRestricted` does for restricted cars, with the field list from research 06 §5.
- **Domain change this needs:** today temperatures, pressures, blisters and the Car Telemetry fields are plain numbers, so they cannot be `unknown`. `UnknownReason` gains `'realism'`; `TyreCorner.surfaceTempC`, `pressurePsi`, `blistersPct`, the brake and engine temperatures become `Known`; `CarDynamics` splits into `motion` (position, velocity, orientation, g-forces: public, like a real team's GPS) and `dynamics: Known<…>` (speed, throttle, brake, steering, clutch, gear, RPM, rev lights, DRS, pit limiter). Doing this before sub-project 3's widgets exist is the cheap moment. Our own cars (player and teammate) stay complete. The value cell renders those values as empty cells with "realism" on hover.
- The strategy model's estimation path for hidden rival data is sub-project 4.

## 8. Findability and the dev loop

### 8.1 Catalogue
`pnpm gen` also writes `catalogue.generated.json` (repo root, gitignored; a committed one would conflict across worktrees) from `scripts/gen-catalogue.ts`. It imports every widget `register.ts`, feature `register.ts` and topic file.
- **Content:**
  - per widget: folder, topics (with params shape), options, sizes
  - per topic: owner, mode, rate, binding (calculator, history list, insights or job), the widgets that read it
  - per feature: folder, the matching `strategy` folder if any, calculators (`id`, `reads`, cadence), jobs, config keys, private or analysis
- **Checks,** run in `pnpm check`; each failure names the file:
  - an owner that's neither `core` nor an existing unit, or a topic name not prefixed by its owner
  - a widget reading another display's private topic
  - a display's private topic its own widget doesn't read
  - a widget reading a topic that nothing binds
  - an analysis topic with no reader yet: a warning only, because analyses come first
  - a `topic()` on an append topic or a `folded()` on a state topic
  - a widget `name` that differs from its folder
- **`pitwall where <name>`** prints every folder and file of a unit and its links. `pitwall where --topic <topic>` prints who binds it and who reads it.

### 8.2 Dev inspector
In dev builds only, the command `dev.inspect` (`Ctrl+I`) switches inspection on; clicking a panel opens the inspector for it:
- widget → its topics, each with its current value, status, rate and last update
- topic → binding → feature → calculators, with `reads`, cadence and the last compute time in ms
- the file path at every level; a click opens it through `host.openPath` in Electron, or copies it in a browser

### 8.3 Dev topics
- `dev.catalogue`: the catalogue as the running bridge sees it
- `dev.calcStats`: per calculator, the last and mean compute time and the last run's session time
- Both are published only when the bridge runs with `--dev`; they have owner `core` and are excluded from the determinism hash.
- Measuring compute time needs a clock, so the scheduler gets an optional injected hook `onCalculatorRun(id, run)` that the bridge wraps with its timer. The engine itself still reads no clock, and the hook can't change outputs.

### 8.4 `pitwall dev`
`pitwall dev --replay <file> [--at-lap <n> | --at-time <session ms>]`:
- **A parent process watches and restarts a bridge child.** The child is a normal `pitwall replay` with `--dev`.
- On a change under `apps/bridge/src/features`, `packages/strategy`, `packages/engine`, `packages/domain` or `packages/contracts`, the parent restarts the child. A new process means a fresh module graph, with no ESM cache tricks and a single code path for dev and live.
- The child replays as fast as possible to the session time the previous child reported last (through IPC), then continues with the previous transport state (paused or playing, speed).
- **Windows stay open.** They see a short disconnect, show `stale`, reconnect immediately (dev builds) and get fresh snapshots at the same moment. Determinism guarantees it's the same state.
- **Target:** back on screen within 5 s at any point of a full race. Measured early in the plan. If it's slower, the child fast-forwards from the nearest history snapshot instead of from the session start.
- The UI runs from the Vite dev server inside Electron, so widget, kit and shell edits hot-reload without touching the bridge.

Session 2 of the brainstorm sketched this with the pipeline in a worker thread and the hub in a long-lived main process. A restarted child process is simpler, keeps one code path, and the UI already handles reconnects; that's why this spec uses it.

### 8.5 Replay transport
Shown in the top bar when the feed is a replay: pause, play, speed, "jump to lap N".
- It's the dev loop's way to stay on a moment, and the user's tool for the debrief between sessions (D32).
- **Commands:** `replay.pause`, `replay.play`, `replay.speed`, `replay.jumpToLap`. They're sent as a new client message `{ type: 'replayControl', id, control }`; the bridge answers `notSupported` for a live feed.
- **Jumping back** re-runs the replay from the start (or the nearest snapshot) as fast as possible to the target, using the same mechanism as 8.4. The hub resets the feed as on a new session.

## 9. Gallery and tests

### 9.1 Named moments
- `fixtures/moments.json` names points in the committed fixture segments by receive-time offset from the segment's first record (session time stays 0 before lights out, so it can't name every moment): `{ "ttZandvoortLap1.crossing": { "segment": "tt-zandvoort-lap1.pwrec.gz", "atMs": 2500 } }`.
- `pnpm gen:moments` runs the pipeline headless to each moment and saves every topic's value, for the player and every car param, under `test-support/moments/` (gitignored, deterministic, regenerated before tests).
- **Synthetic cases:** a widget's `gallery.ts` adds hand-written topic values for what no recording has yet (SC, pit stop, rain, tier-1 alerts; review F8). When a recording arrives, a named moment replaces the synthetic case.
- `gallery.ts` declares which moments and cases a widget is shown with.

### 9.2 Gallery
A `/gallery` route in dev and test builds renders every widget × each size mode × each moment and case × each theme variant.
- It also shows the panel frame once in each state (no data, errored, stale, `Computed` age, unknown widget) and the kit's parts with sample data (5).
- Widgets get their data from the moments, through the same props as in the app; the component can't tell the difference.

### 9.3 Tests

| Kind | What it checks | Tool |
|---|---|---|
| Unit | emphasis functions, kit folds, the topic store against a fake connection, the command registry, lenient workbook and keys parsing, `uiAction` handling in the bridge | Vitest |
| Property | the UI fold equals the bridge fold for any lap sequence; workbook and keys parsing never throws; a reconnect leaves the store equal to a fresh subscription | fast-check |
| Type | `defineWidget` types the props from `data` and `options`; a wrong topic, wrong params or an undeclared option fails (`@ts-expect-error`) | `pnpm typecheck` |
| Fit | every widget at its minimum size, at each mode, and at sizes between modes: no overflow, no clipped text | Playwright |
| Screenshot | every gallery cell against a committed baseline PNG | Playwright driving Electron (`_electron.launch`), so the screenshots use exactly the Chromium you see |
| End-to-end | bridge plus a fixture replay plus two windows: the placeholder shows feed status; reconnect; a workbook switch reaches both windows; an acknowledge shows in both; `pitwall dev` restores the moment after a feature change | Playwright |
| Catalogue | each check in 8.1 on small fixture trees | Vitest |

- **Mutation testing** (`pnpm mutation`) extends to the UI's pure modules: `emphasis/`, the kit folds, the topic store, workbook and keys parsing. Components are not mutation-tested.
- **Two-phase workflow for a display:**
  - The test agent writes the gallery cases, emphasis tests, type tests and fit expectations. They fail because the widget doesn't exist.
  - The implementation agent builds the widget until they pass and produces the screenshot baselines.
  - Baselines are the one exception to "tests first". The user approves them visually and the supervisor commits them.
- **Sub-project 2's baselines:** the panel frame in every state, the kit parts, the top bar (alerts synthetic), the shell overlays (palette, key overview, settings popover, inspector), and the placeholder on Zandvoort moments. Mockups of these come first, and the user approves them before implementation.

## 10. Packages and dependencies after sub-project 2
- New: `apps/desktop` (Electron; imports nothing from the workspace).
- `apps/ui` (Svelte 5, Vite, dockview-core, uPlot, JetBrains Mono bundled locally) imports only `contracts` and `domain`, as today.
- dependency-cruiser gains the rules of 4.6 and `apps/desktop → nothing`.
- `pnpm gen` runs `gen:features`, `gen:topics`, `gen:widgets`, `gen:catalogue`. `gen:moments` runs before the UI tests.

## 11. ADRs to write
- **0010 Electron as the host, UI host-agnostic** (7.1).
- **0011 Analyses and displays:** units, topic owners, write scopes (3).
- **0012 Widget registry via a generated index** (4.1); it extends ADR 0005.
- **0013 UI state owned by the bridge** (7.8).

## 12. Acceptance criteria
1. `pnpm check` is green, including the catalogue checks, the new dependency rules and the UI tests.
2. `pnpm --filter @pitwall/desktop start` opens the windows of the default workbook at their saved geometry, starts the bridge, and the placeholder shows live feed status.
3. On the Zandvoort fixture with `pitwall dev --replay … --at-lap 5`, editing the `feed-status` feature's calculator puts the windows back on lap 5 with the new values within 5 s.
4. A new display with no shared-file changes, used as the plan's dry run: adding a widget folder and its topic file, with only `PITWALL_WORKER_UNIT` set, passes the guards and `pnpm check`, and appears in the catalogue and the inspector.
5. A workbook switch with `Ctrl+2` reaches both windows; an acknowledged alert disappears in both; restarting the bridge keeps the active workbook, link groups and acknowledgements.
6. A hand-broken workbook (unknown widget, bad option) opens with the notes from 7.2 and nothing else broken.
7. Every gallery cell has a user-approved baseline; the fit test passes for every widget at every declared size.

## 13. Open points
- The mockups of the kit, panel frame, top bar and overlays (9.3) are made and approved at the start of the plan, with the cached headless Chromium.
- Session 1's undecided colour questions (compound as a letter or a letter plus colour; which personal-best sectors light up) become theme variants and are settled with the first timing displays in sub-project 3.
- The 5 s target of 8.4 is measured early in the plan.
- `race.moment` is shown when present; its analysis and shape come with sub-project 3 or 4.
