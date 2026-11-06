# Working area of the planning skills

The spec or plan of the work in progress lives here (`specs/`, `plans/`), written by the brainstorming and writing-plans skills. When a spec or plan is done, superseded or void, it moves to `docs/history/` and gets a row in `docs/history/README.md`. A spec that still states product intent moves to `docs/specs/`.

Current: the SP4 re-spec, `specs/2026-11-05-sp4a/`: `00-carry-over.md` (what carries over, and the brainstorm answers), `01-sp4-sections.md` (dependency graph and sections). SP4.0 (foundation and track) is **done**, merged 2026-11-06: spec `docs/specs/2026-11-05-sp4.0-foundation-and-track-design.md`, plan and run rulings in `docs/history/`.

Open before or with 4.1:
- **Track sidecar always written (user chose option A, 2026-11-06):** a session without a valid track file writes no track sidecar, so its replay changes once a file is added (C38). Change C62b's text first (contract and ADR line, C0: "a session without a valid file writes a not-applicable sidecar; a recording without any sidecar loads the committed file"), then `feed-pipeline.ts` writes the run's track always and `recordingTrack` honours a not-applicable sidecar, in two phases.
- **Loading screen during the startup rebuild:** C61 says "with progress shown"; today the desktop window is black until the rebuild ends (user, 2026-11-06; another session works on it).
- **Add and remove panels in the UI (user, 2026-11-06):** a visible UI element to add a panel to a window and to remove one, without the command palette (today only "Add panel: …" via Ctrl+K exists, and nothing removes a panel). Each button still invokes a command from the shell's one registry (C72), so a `panel.remove` command comes with it. Hand edits of `ui/workbooks/*.json` hot-reload while the bridge runs and work well meanwhile.
- **`pnpm desktop` builds the UI before the widget index is regenerated:** the UI build runs first and the bridge's `gen` after it, so the first start after a new widget shows the old widget list. Run `pnpm gen` before the UI build in the desktop start script.

Next: spec 4.1 (estimation and long run) from `01-sp4-sections.md`.
