# 0013: UI state owned by the bridge

## Status

Accepted (2026-10-28). UI shell spec 7.2, 7.5, 7.7, 7.8.

## Context

Workbooks (windows and their panels), link groups, alert acknowledgements and settings must be the same in every window, survive a restart and be editable by hand. The UI windows are separate browser or desktop windows; each has its own `localStorage`.

## Decision

- **The bridge owns the state** and publishes it as four global topics (`ui.workbooks`, `ui.linkGroups`, `ui.alerts`, `ui.settings`, owner `core`). A window changes it only by sending a `uiAction`; the answer is `actionResult`. The bridge validates structure only (shapes; a panel's `options` is an object; `layout` is kept as is). Widget names and option values are the UI's job.
- **Files** in `PITWALL_DATA_DIR/ui/`:
  - `workbooks/<name>.json`, one `Workbook` each; the first start creates `default.json`
  - `state.json`: `{ activeWorkbook, linkGroups, acknowledged, muted, realism }`
  - `keys.json`: optional, only read, shown as `ui.settings.keys`
- **Autosave** is debounced by 300 ms. Every write goes to a temp file first and is then renamed, so a reader never sees half a file. `workbook.updateWindow` replaces one window by id, so changes to two windows never overwrite each other.
- **Hand edits:** the bridge keeps the SHA-256 of what it last wrote or read per file and watches `ui/workbooks/` and `keys.json` with `fs.watch`. A file whose hash differs is read again (after a short delay, so a plain non-atomic editor write is finished) and, if it is the active workbook, published. The bridge's own writes carry the stored hash and cause no re-publish.
- **A broken hand edit** (invalid JSON or wrong shape) of the active file sets `ui.workbooks.error` to the message, keeps `active` at the last good version and pauses autosave of that file, so the engineer's text is never overwritten. A valid version clears the error and resumes autosave.
- **Realism:** `realism.set` only changes `state.json` and `ui.settings.realismNextSession`. It never changes the running session; the next session start reads it.
- **Acknowledging all** carries the keys the UI saw, so an alert raised in between is not acknowledged unseen.

## Why the bridge and not `localStorage`

- `localStorage` is per window and per origin; two windows (and the desktop shell) would diverge.
- The files can be edited, copied and versioned by hand; browser storage cannot.
- The state survives a browser profile reset and works with any number of windows without them talking to each other.
- The bridge already is the single process every window connects to.

## Consequences

- A window shows UI state only after the first snapshot of the `ui.*` topics.
- The state is not part of a recording; `ui.*` topics are excluded from the determinism hash.
- A second bridge on the same data directory would fight over the files; one bridge per data directory.
