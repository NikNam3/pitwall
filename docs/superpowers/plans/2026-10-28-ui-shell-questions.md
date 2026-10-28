# UI shell (sub-project 2): questions for the user

Collected during the autonomous run. Each question has the default the supervisor chose, and work continued on that default. The user answers them in Task 24, or earlier if every task is blocked.

| # | Task | Question | Default chosen | Why |
|---|---|---|---|---|
| 1 | 15 | A window's saved dockview layout can't be restored (hand edit broke it). Spec 7.2 says open an empty window; should it instead lay out the workbook's panels in the default arrangement? | Default arrangement of the window's panels | No panel disappears from view; the panel specs in the workbook stay unchanged either way |
| 2 | 7 / 7b | `pitwall dev` takes ~50 s to come back at the end of full Zandvoort (target 5 s, spec 8.4). Profiling: 47 s is the fast-forward itself (decode 45 %, GC 11 %, engine 17 %); main and this branch replay at the same speed. A checkpoint resume (old child writes a v8 checkpoint, new child resumes if every file in the pipeline's import closure is unchanged) would give ~3 s, but only for feature/strategy/UI edits: engine, protocol and pipeline edits, and any insight calculator, fall back to ~50 s; checkpoints are ~35 MB; at the end of a 90-min race the record skip alone is ~5 s. Build it now? Design: docs/superpowers/notes/2026-10-28-dev-restart-checkpoint-design.md | Not built in this run; only the cheap hot-spot fix (cached cadence median) | Clean code ranks above performance; the resume adds engine checkpoint methods and an import-closure validity rule that the next sub-project (insight calculators) would switch off |
