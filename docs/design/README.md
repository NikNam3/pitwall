# Approved display designs

The mockups the user approved, one folder per design round. A display worker reads the folder of its sub-project before building; the look in these files is the target, the presentation rules of the contract (C64–C69) say where it is implemented.

| Folder | Covers | Status |
|---|---|---|
| `2026-10-28-ui-shell/` (+ `2026-10-28-ui-shell.md`, the brainstorm) | visual system: typeface, value states, cells, tables, charts, panel frame, top bar, overlays | approved, built |
| `2026-10-29-sp3-displays/` | sub-project 3 displays: car care, timing, gap chart, layouts | approved, built (e2e tests check `4-layouts.html`) |
| `2026-10-30-sp4a-displays/` | SP4a displays: layouts, ghost views, map, call cards, long run, weather, options | approved; SP4a itself is void until re-specced, so these are design input, not a build target yet |

Regenerate a folder's pages with its `gen.mjs`.
