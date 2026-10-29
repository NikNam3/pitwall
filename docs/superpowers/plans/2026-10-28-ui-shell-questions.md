# UI shell (sub-project 2): questions for the user

Five open decisions from the autonomous run. The code currently does option **A** in each case, so nothing is blocked; pick a letter (or write your own) under **Answer**, and the next session applies every answer that isn't A.

---

## Q1. A window's saved layout is broken. What should the window show?

When a hand edit breaks a window's dockview layout so it can't be restored. The workbook's panel list is fine either way; only the arrangement is lost.

- **A.** All of the window's panels, in a default arrangement. *(built)*
- **B.** An empty window with an "add widget" button, as spec 7.2 says. The panels stay in the file but aren't shown until you add them again.

Recommendation: A, no panel disappears.

**Answer:** A

---

## Q2. Should `pitwall dev` get a checkpoint restart?

After a code edit, `pitwall dev` takes about 50 s to put the windows back at the end of the full Zandvoort recording; the target is 5 s (spec 8.4). Almost all of it is the replay fast-forwarding from the start. The design (`docs/superpowers/notes/2026-10-28-dev-restart-checkpoint-design.md`): the old process saves a checkpoint, and the new one resumes from it if the engine/pipeline code didn't change.

- **A.** Not now; live with ~50 s for long recordings. *(built: only a small speed-up)*
- **B.** Build it now. About 3 s for edits to features, strategy and the UI. Edits to the engine, protocol or pipeline, and any insight calculator (the next sub-project), still take ~50 s. Checkpoints are ~35 MB. At the end of a 90-minute race the restart is still ~5 s.
- **C.** Look for a different approach first (for example a seekable recording format).

Recommendation: A or C; B helps least exactly where sub-project 3 will work.

**Answer:** A, C later

---

## Q3. Charts with less history than their width: show negative laps?

A chart shows `width in cells × laps per cell` of history. Early in a session there's less history than that, so the x-axis currently runs into negative laps (the gallery's sample chart shows −15 … 5).

- **A.** Keep it: the axis always spans the full width, empty on the left. *(built)*
- **B.** Start the axis at the first data point (or lap 0), so a young session's chart is stretched to the width.

Recommendation: B, negative laps look like a bug.

**Answer:** B

---

## Q4. Do you approve the screenshot baselines?

109 screenshots in `apps/ui/e2e/__screenshots__/`: every gallery cell (the `feed-status` widget at each size, moment and theme variant; the panel frame states; the kit parts). The supervisor compared them with the approved Task 0 values. They are committed provisionally, and every later look change will be compared against them pixel for pixel. To see them live: `pnpm ui:dev`, then open `/gallery`.

- **A.** Approved as they are.
- **B.** Not approved: list what to change.

**Answer:** A

---

## Q5. Screenshot coverage for the top bar and the overlays: when?

Spec 9.3 wants gallery cells and baselines for the top bar and the shell overlays (palette, key overview, settings popover, inspector), plus an end-to-end test that `pitwall dev` restores the moment. The plan had no task for them, so only unit tests cover these parts now.

- **A.** As the first task of sub-project 3, before its first display. *(planned default)*
- **B.** Right now, as a small extra task on top of the UI shell.
- **C.** Later; unit tests are enough for now.

Recommendation: A.

**Answer:** A
