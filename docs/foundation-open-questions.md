# Open questions from the foundation run

Each question has a provisional ruling already in effect in the code. Write your answer under "Answer:"; leaving it empty keeps the ruling.

## Q1 — Units of raw physics channels (non-blocking)

**Context:** The Global Constraints say speed is in km/h and angles in rad. The Task 9 brief, however, puts the per-car motion fields (world velocity, wheel speed, slip angle, other MotionEx wheel values) in m/s, and setup camber/toe in degrees, as the game reports them. Some of these fields have no unit in their name.

**Options:**
- A (current ruling): keep the raw physics channels in game units (m/s, degrees). "km/h" applies to the displayed car speed only. Add unit suffixes to the field names when they get filled (Task 14).
- B: convert everything to the Global Constraint units at the engine boundary (km/h, rad).

**Recommendation:** A. Physics channels are used for analysis rather than display, and converting them adds rounding for nothing.

Answer: A

## Q2: Live acceptance run and a flashback recording (non-blocking, needs you at the game)

**Context:** Task 30's acceptance criteria 2 (live packet/topic rates) and 4 (flashback in practice) need a running F1 25 session. A flashback recording is also needed to confirm the `replayWindowMs` default of 10 000 ms (spec correction 5) and to cut a flashback fixture segment. Step-by-step instructions are in `docs/acceptance/live-checklist.md` (sections 1–4) in the worktree.

**What to do:** once the foundation is merged, run the checklist with the game. Record a practice session that includes at least one flashback, using the recorder, and put it in `recordings/`. Then fill in the checklist's Results section.

**Recommendation:** do it at your next game session. Until then, everything except those two criteria is verified automatically.

Answer:

## Q3: Snapshot retention for flashbacks (non-blocking)

**Context:** Spec 5.4 keeps a state snapshot every second for the whole session. One snapshot is about 130–160 KB (mostly 22 cars' tyre sets), which comes to about 0.5 GB per hour of session on your laptop. Flashback targets inside the replay window (10 s) are replayed exactly. Older targets restore from the nearest snapshot and are approximate either way.

**Options:**
- A (current ruling): keep the first snapshot and every snapshot inside the replay window; beyond it keep one per 30 s. Memory stays at a few tens of MB per hour.
- B: follow the spec exactly and keep one snapshot per second for the whole session.

**Recommendation:** A. It costs nothing for the flashbacks the game actually allows (seconds back), and bounds memory.

Answer: A
