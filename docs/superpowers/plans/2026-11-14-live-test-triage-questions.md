# Live test 2026-11-14: triage and questions for the user

Written overnight 2026-11-14 (supervisor, alone). Sorts the findings of the Silverstone live test (`docs/acceptance/live-checklist.md`, "2026-11-14: live test notes") and the proposals of research 20 and 21 into bugs, contract gaps and wishes, and asks what becomes a task. Nothing here is built or started.

## 1. The sort

| # | Finding | Kind | Evidence | Proposed home |
|---|---|---|---|---|
| T1 | Strategy candidates drop the zero-stop plan | **bug against the spec** (SP4.3b §6 "best base plan per stop count (0 to 3)"); the cap is run ruling R49 / Task 23a, never reported to the user | `strategy/candidates.ts:73–76`; research 21 §12 | fix run (Q1) |
| T2 | The DP plans on today's wetness for every lap | **bug against the spec** (§6 input "the plain forecast's wetness path") | `shared/strategy-input/dp-input.ts:109`; research 21 §12 | fix run (Q1) |
| T3 | The DP gives every compound the fitted set's wear rate and ν | **bug against the spec** (§6 input "the wear rate per compound") | `dp-input.ts:84–85, 100`; `race-forecast/field.ts` `fitStop` | fix run (Q1) |
| T4 | Zero-stop and stay-out candidates carry the best plan's "box for mediums" SC/VSC triggers | spec gap (§8.1 says "each with the DP's trigger thresholds", not whose) | `candidates.ts:71, 82–83`; 0.24–0.26 places | fix run (Q1) |
| T5 | "Stay out" means "not this lap", the panel reads "to the flag" | wording / spec gap | `strategy-dp/index.ts:11–13` | fix run (Q1) |
| T6 | Fresh inter life 13.3 laps from no lap (age basis on the default ν) | bug (a number on no data; C3 spirit: should be `insufficientData`) | research 21 §2 | fix run (Q1) |
| T7 | Live wear rate: median of whole-percent gains never converges | model weakness, high confidence | research 21 §2 | fix run (Q1) |
| T8 | `track-wetness` has no state without a dry reference (restart, wet start) | spec gap; fits C62a as a priors entry, no contract change | research 21 §9 | fix run (Q1) |
| T9 | A bridge restart starts an empty log and replaces the stored session | **contract gap** (C59–C61 assume one recording per session) | `storage-writer.ts` `startSession` (Task 27 ruling); research 21 §12 proposal 8 | Q2 |
| T10 | Silverstone has no pit-loss default; its hard offset +6,956 ms is a wet race's | track data bug (`pitwall-trackdata` generator) | live checklist; research 21 §8 | fix run, aux repo (Q1) |
| T11 | Track-file soft offsets have the wrong sign at 3 of 4 tracks | track data weakness (median race laps, not fresh-set offsets) | research 21 §8 | Q1 (generator) |
| T12 | Gap chart shows no data | spec gap: a race joined after lights out has no race start, so `gaps` draws no line, all race (both runs joined mid-race) | `gaps/calculator.ts:90–93, 130–133`; replay of both recordings | Q7 |
| T13 | Track-map SC/VSC/rejoin ghosts jump | design gap: `rejoin` moves the map point only on our mini-sector crossings (~every 1.7 s, ~85 m hops) | `rejoin/calculator.ts:112, 120` | Q6 |
| T14 | Track maps: driver names on cars | wish | | Q6 |
| T15 | Tyre pressure bands uncalibrated | calibration, proposals ready (research 20 §7.1 A–D) | | Q3 |
| T16 | Silverstone inter stint as an outlier for DR's profile and the set | user action (exclusion exists, C62c / C62a) | research 20 §7.3, 21 §9 | Q4 |
| T17 | Wear scales with the race-distance setting (medium long ≈ 2.1 ×) | model gap, high confidence it exists | research 21 §13 | Q5 |
| T18 | Setup pressure shown before the race | wish; the data says it cannot judge "too high" (research 20 §7.4) | | later: setup sub-project |
| T19 | `pitwall strategy` has no run-count override | tooling | research 21 §12 proposal 9 | fix run (Q1) |
| T20 | `crossover.car` on the recording: what did it say? | answered: nothing all race (no dry reference) | replay, §4 | T8 |
| T21 | The game's TyreSets (`usableLife`, `lapDeltaTime`) are in the live state but unused by the strategy model; they predict AI wear (r 0.977), carry the race distance, give compound offsets, and the AI switches tyre type on the delta's sign | **new finding**, research 22 | `state-update/tyres.ts:20–22` | Q1, Q5 |

## 2. Questions

## Q1. Should a short "strategy fixes" run come before the 4.3c brainstorm, and with what in it?

Silverstone showed the strategy table missing the right answer (stay out on inters) for three laps. Research 21 §12 traced it to three places where the code does not do what the SP4.3b spec says (T1–T3) plus several weak model terms. 4.3c (planning displays) would show the same plans, so wrong candidates would reach the new displays too.

- **A.** One fix run now, before 4.3c, with the spec bugs and the high-confidence items only: T1 (best plan per stop count kept, beside the top 8), T2 (the DP gets the wetness path), T3 (per-compound wear and ν after a stop), T4 (zero-stop and stay-out with their own SC/VSC triggers, plus a pure stay-out row), T5 (wording "not this lap" against "to the flag"), T6 (no age-basis life for inters and wets: `insufficientData` while ν is the prior), T7 (live wear rate as the cumulative gain over ≤ 5 green laps, used from 3 laps and 5 % accrued; this overrides your ruling of 2026-10-30 behind `per-lap-rate`'s `minSamples` 2, for wear only: fuel and ERS keep it), T8 (a dry-reference priors entry for `track-wetness`, C62a), T19 (`pitwall strategy --runs`), and T21's priors from the game (research 22): wear prior `k × 70 / usableLife` (AI 0.86, human 1.3 until the profile's own k), ν prior from the game's ms per % wear, fresh-set compound offsets from `lapDeltaTime` instead of the track files. Track data fixes T10 in `pitwall-trackdata` beside it (dry-year fallback for pit loss and offsets). Validation: replay Silverstone laps 36–52 and the Spa score; laps 38–41 must show "no stop" among the rows.
- **B.** As A, and use the game's delta of the other tyre type as the AI field's switch signal in `rival-stops` and beside the 110 % line in `crossover` (research 22 finding 7: every Singapore switch came on the delta's first negative lap; Silverstone never went negative and nobody switched). Plus the medium-confidence tyre terms of research 21 §10 (inter wear against wetness, inter ν prior 15 ms/lap, ν fit net of the field's trend on a drying track, driver factor on the AI rate, cold-tyre terms on laps 2–3, crossover 1.075). These need a forecast-score sweep over every recording first (ETH HPC); the run gets longer by the sweep.
- **C.** No separate run: fold everything into the 4.3c spec.

Recommendation: **A**, and B's switch signal too (it is one read of a value already in the live state, and it is the call Silverstone needed); the other B terms (wetness slopes, cold tyres, 1.075) as the first item of the next strategy spec, after the sweep. With the game's priors many of research 21 §10's rows (wear prior, driver factor, race-distance table, per-track wear entries) become fallbacks only. T1–T3 are not choices: the spec already asks for them. R49 (Task 23a) introduced the top-8 cap as a "spec refinement to report to the user"; this is that report.

A unit-by-unit draft of A is in `docs/superpowers/specs/2026-11-14-strategy-fixes-DRAFT.md` (not a spec; for speed if you pick A).

**Answer:**

## Q2. A bridge restart mid-session: should the new run continue the old one?

A restart now starts an empty log, and storage keeps only the newest run of the session (Task 27: "the newest run wins"). At Silverstone that lost laps ~22–36: the slick laps `track-wetness` needed, about 15 laps of pace and wear per car, and the first run's stored log. The contract assumes one recording per session (C59 "a `.pwrec` file", C60, C61 rebuild "from its recording").

- **A.** Keep as is. T8 (a dry-reference prior) removes the worst effect; the other losses stay.
- **B.** Chain the recordings. A live session whose key (session uid, weekend, player car) is already stored with another recording first replays that recording into the new run's engine, then goes live; the session row lists its recordings in order; a rebuild and a replay run the chain; the frames in between are a gap the clock records as a forward jump (C36). Contract change: C59 (a session's recordings, in order), C60, C61, C38 (determinism over the chain), C76 (decisions per recording position). Cost: a mid-size task in the bridge and the runner; replaying ~15 laps at start takes a few seconds.
- **C.** As B, but only for the stored log (storage keeps both runs' facts); the live run still starts empty. Small, but the live strategy gains nothing.
- **D.** One recording per session, continued. On a restart under a stored key, the bridge trims the session's `.pwrec` to its last complete record (a crash cuts it mid-record), replays it into the new run's engine, then appends the new packets to the same file after a "resume" record (a new record kind, wall time of the restart, so record times stay non-decreasing); the sidecars likewise. A replay, a rebuild (C61) and reprocess (C38) read one file as today. C59's "a `.pwrec` file" stays literally true; the change is to the format (`pitwall-recorder/FORMAT.md`: the resume kind, and readers continue past it) and to Task 27's "the newest run wins" ruling. Whether this needs contract text is your call; I read C59–C61 as unchanged.
- Note: neither B nor D fixes the gap chart at Silverstone: the first run had also joined after lights out (Q7).

Recommendation: **D**, else B. Restarts will happen again (crashes, updates, the several-feeds setup), and the strategy is weakest exactly then; D keeps one file per session, so every reader stays as it is.

**Answer:**

## Q3. Which tyre temperature and pressure bands should `car-bands` use?

The game computes the pressure from the setup and the carcass temperature with a reference temperature per compound (C1 105 … C5 80, inter 65, wet 55 °C), and the AI's temperatures and pressures are constants (research 20 §1). Today one slick carcass band (70–105 °C) and a pressure band of setup −1.5 / +1.0 psi. Research 20 §7.1 has four proposals:

- **A.** Carcass bands per actual compound, reference −20 … +15 °C (C1 85–120, C2 75–110, C3 70–105 as today, C4 65–100, C5 60–95, inter 45–80, wet 35–70).
- **B.** The pressure band derived from the carcass band (about −5.5 % / +4 % of setup), so both say the same thing in two units.
- **C.** Surface bands: wet lowered to about 30–55 °C (thin); slick and inter kept.
- **D.** Judge temperature and pressure bands only on human-driven cars (car driver, C17); AI values are constants and say nothing.

Recommendation: **all four**. A keeps your 70–105 °C for C3, the commonest compound. The inter top of 80 °C would have flagged Silverstone by lap 43; whether that is "out of band" or a wear warning is your call.

**Answer:**

## Q4. Should Silverstone 2026-11-14's inter stint stay out of DR's driver profile and the Silverstone calibration set?

Car 19 wore its inters 1.9–2.1 × the AI against DR's usual 1.2–1.3 × (drying track plus an overheating carcass; research 20 §7.3, 21 §9). The exclusions already exist (C62a sets, C62c profiles); this is your action, not a task.

- **A.** Exclude it from both.
- **B.** Keep it in the set (it is Silverstone's only inter data), exclude it from DR's profile.
- **C.** Keep it in both.

Recommendation: **B**: with the game's wear prior (Q1 A, research 22) a set's absolute inter wear matters less, and it is Silverstone's only inter data; the profile should hold DR's normal driving (this stint is 2.3 × the game rate against DR's usual 1.2).

**Answer:**

## Q5. How should wear rates handle the race-distance setting?

The game scales wear with the menu's race distance (medium long ≈ 2.1 × full at Suzuka, research 21 §13), and calibration sets and profiles pool settings today. Research 22 found the game publishes the scaled rate itself: `usableLife` per car and compound is 2.0 × shorter in the 19-lap Suzuka weekend, practice included, and 0.86 × 70 / `usableLife` is the AI's measured rate (r 0.977).

- **A.** Store rates relative to the game's: a profile's driver factor is the person's wear ÷ (70 / `usableLife`) of their own car (DR 1.19, Asym 1.42 so far), a calibration set's wear entry likewise; at run time multiply by the session's own `usableLife`. No race-distance table, no setting to store. No contract change (the values are in the live state; a recorder needs them in a fact so stored projections carry them, C23/C62a).
- **B.** As research 21 §13: store `m_sessionLength` with every source and normalise by a measured table (full 1.0, medium long 2.1).
- **C.** Ignore it until more recordings exist.

Recommendation: **A**. The game already carries every setting we know of (and any we do not); B needs a factor measured at one track.

**Answer:**

## Q6. Track maps: smooth ghosts and driver names, as one display task?

The ghosts hop because `rejoin` moves them only on our mini-sector crossings (`rejoin/calculator.ts:112`, cadence `ourCrossing`, about every 1.7 s, ~85 m per hop); the cars themselves update every frame at 10 Hz. Names: `MapCar.code` (3-letter code) is already published but not drawn; the approved mockup `2-map-views.html` shows it.

- **A.** Compute the map point from "now − loss" every frame in a small quick unit beside `rejoin` (the rejoin order stays on crossings), topic at 10 Hz like the cars; draw the codes at full size in `textFaint` with the existing label layout. No contract change; a spec edit (SP4.2 §3.2, the timing spec §7.2).
- **B.** Animate the rings in the kit's track canvas instead. Grey area under C65 (a display interpolating), and it still trails by up to 1.7 s.
- **C.** Names only now, ghosts later.

Recommendation: **A**, one small two-phase task. Check online: with names hidden the game may send placeholder names, so every human could read the same code.

**Answer:**

## Q7. The gap chart in a race joined after lights out: what should it show?

Both Silverstone runs joined the race mid-way (the first at about lap 22, the second at lap 36), so neither saw lights out. `gaps` then has no race start (`gaps/calculator.ts:90–93`, a `racing` span with `joinedAt`), the reference lap is unknown and every car's line is empty, for the whole race (verified on both recordings). The same holds for every race the bridge starts late, and the rejoin ghost lines use the same function (noticed, not verified).

- **A.** A "join origin": the leader's first line crossing after the join is the chart's start; gaps between cars stay exact, only the virtual car's constant offset differs from a race seen from the start; the output marks the origin as a join with its lap. A spec change to the timing spec §6.1, no contract change (C3, C31, C43).
- **B.** Rebuild the true race start from the game's SessionHistory lap times as step-1 values. Touches facts about frames before the first frame (C21, C26): check for a contract gap first.
- **C.** Leave it: the chart says "no data" in a joined race.

Recommendation: **A**, in the fix run of Q1 (or as its own small task).

**Answer:**

## 3. Diagnoses

- **Ghosts (T13):** see Q6. Cause verified in the code (`rejoin/calculator.ts:112` `mapPointAt(ctx.ours, latest - loss, …)`, cadence `ourCrossing` at line 120; topic `rejoin.car` at `maxHz` 4). The display does no smoothing (`kit/track/TrackCanvas.svelte:99`).
- **Gap chart (T12):** see Q7. Root cause verified by replaying both recordings with `gaps.gapper` subscribed (`carAverage`, car 19, as the user's panel): `ok`, cars listed, `referenceLapMs` `notReceived`, no car with points; `sessionPhaseRace` has one `racing` span with `joinedAt: true`. Ruled out: panel params, binding and demand (C49), realism, the 514d915f bug, feed routing. Scripts and logs: `~/dev/personal/pitwall-research/live-test-2026-11-14/gap-chart/`.

## 4. Overnight checks

- **`crossover.car` on the Silverstone recording (T20):** replayed (`pitwall-research/tyre-spike/crossover/capture-crossover.ts`): `dryRefMs`, `line110Ms` and `ourPct` were `insufficientData` on every update of the race, `firstFaster` `notApplicable` (no car on another tyre type). It said nothing all race, for the same reason as `track-wetness`: no slick lap after the restart. T8 (a dry reference prior) fixes both; the game's own slick delta (research 22, +2.1 s from lap 46) would have answered the question directly.

## 5. Input for the 4.3c brainstorm (planning displays: V17 plan board, V06 strategy overview, V01 circle of doom)

Not questions yet; what Silverstone teaches for 4.3c, to bring into the brainstorm.

1. **The call that was needed was conditional:** "stay out on inters; box for mediums only if the track dries below about 107.5 % for two laps." The plan board (V17) is the place for that: plan A with its armed triggers, and the trigger's threshold in a unit the engineer reads (% of the dry lap, not wetness in ms). The DP already gives a rain threshold (spec §6, "the wetness at which a switch beats staying out"); 4.3c needs it as a lap-time %, and beside it the game's own delta of a fresh slick against the fitted inter (research 22: the AI switches when it turns negative), which is the trigger the field will follow.
2. **"Stay out" needs two meanings on screen:** not this lap (closed-loop) and to the flag (the zero-stop plan). T5 decides the words; V17 shows both rows.
3. **The rival's predicted stop moved our P1 by 0.17** (car 11's `rival-stops` window L43–51, which never came). V06 (one row per car, stints as blocks) should show predicted rival stops as uncertain blocks, so the engineer sees what the win chance rests on.
4. **Cold start after a restart:** for 2–3 laps every strategy number was `insufficientData` or a prior. Planning displays need a visible "on priors" state per number (as the damage card's "measuring" wish of 2026-11-05).
5. **V01 (circle of doom) reuses the ghost of Q6 A:** the same per-frame map point, placed by time gap on the circle. If Q6 A is built first, V01 gets its ghosts for free.
6. **Win chance at 80 runs is a multiple of 1/80;** a planning display showing P1 needs its uncertainty (± SE) or a coarser format, or the cap must grow for the top rows only.
