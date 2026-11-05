# Live-test fixes: questions for the user

Five decisions the plan (`2026-11-05-live-test-fixes.md`) needs. Each names the option the plan builds if you have no answer. The evidence is in `docs/acceptance/live-checklist.md`, section "2026-11-04/05".

## Q1. Which laps should the tyre and brake band alarms judge?

On lap 1 of the race and on the safety-car laps, cold tyres raised up to nine advisories at once and two critical "out for the whole lap" alarms. Everyone knows tyres are cold then. The AI teammate (Russell) reads a flat 90 °C carcass on every corner for most of the race, so its tyre bands mean little.

- **A.** Judge only rate laps that are not lap 1 of a race: no in-lap, out-lap, safety-car or VSC lap (the `forRate` class `fuel` and `pace` already use), and not lap 1. The live band colours stay as they are; only the lap judgement and its alarms skip those laps. AI cars stay judged.
- **B.** As A, and no band alarms for an AI-driven car. **This needs a contract change:** whether a car is AI-driven is the `aiControlled` signal, which only the machine reads (C12, C13), and no sub-machine turns it into a situation yet. It would add a sub-machine (car control: human or AI) to the inventory (C17).
- **C.** Keep judging every lap, but only raise the alarm on the second lap in a row out of band.

Recommendation: **A** now (built), B later as its own contract change if the AI alarms still bother you.

**Answer:** A (user, 2026-11-05). Refined the same day: **band alarms are hidden while the safety car is out, and come back at "safety car in this lap"** (user: "they can be hidden until safety car in this lap, then they become important again"). From then on they judge the newest clean lap (before the SC) until a new clean lap replaces it.

## Q2. How should the carcass band's two levels show and alarm?

Your friend's ranges for the slick carcass: below 70 °C too cold, 70–80 okay, 80–100 good, 100–105 okay, above 105 too hot. Today the band has one level (75–110 °C): inside is plain, outside is amber, and a whole lap outside is a critical alarm. Your colour rule is grey unless something needs attention.

- **A.** Good and okay both plain (grey); amber and the advisory only outside okay (below 70, above 105); critical for a whole lap outside okay. The "good" range is shown as the band's inner mark in the corner block, so you see where the sweet spot is.
- **B.** Good plain, okay amber (no alarm), outside okay red with the advisory; critical for a whole lap outside okay.
- **C.** As B, and the advisory already on a whole lap in "okay".

Recommendation: **A** (built). It keeps 70 °C uncoloured, as you asked, and still shows the target.

Only the slick carcass gets two levels. Surface, brakes, engine, the intermediate and wet carcass keep their one band until you give ranges for them.

**Answer:** A (user, 2026-11-05). Also confirmed: 100–105 °C is okay, not good. Later the same day: **pitwall ignores "good"** (user: "our software can ignore good"). The slick carcass keeps one band, 70–105 °C: no colour inside, amber and the advisory outside, critical for a whole lap outside. No target mark, no second level.

## Q3. What should the tyre pressure band be?

The band is one fixed range, 20–31 psi, for all four tyres. Your friend's setup is 20.9 psi rear and 24.2 psi front. Warm, the live pressure sits at the setup value: in practice rear 19.7–21.5 psi (p5–p95), front 22.6–24.9. Cold (race start, safety car) the rears fell to 18.8. The game's setup (with the pressures) reaches pitwall for the player's car only (see Q5).

- **A.** Per corner, relative to the car's own setup pressure: in band from setup − 1.5 psi to setup + 1.0 psi (tonight's spread, pitwall estimate). Every other car's pressure band is unknown (`notReceived`), see Q5.
- **B.** Per axle, fixed: front 22–26 psi, rear 19–23 psi (from tonight's data, one driver, one track).
- **C.** No pressure band alarm; show only the difference to the setup pressure.

Recommendation: **A** (built): it follows any setup and any track.

**Answer:** the user has no view yet ("do as you think fits for now, I'll fix it once I understand more about it", 2026-11-05). Built: A, provisional; the offsets are config with a pitwall-estimate source note, so changing them later is a config edit.

## Q4. Which warnings lead to a penalty, and in which sessions?

The "one warning left before a penalty" alarm counts every warning together and fires in every session. Tonight's race: warning 1 was corner cutting, warning 2 a small collision. The game then counted 2 warnings, 1 of them corner cutting. In practice warnings never led to a penalty (4 warnings tonight, 9 in an older practice). In the three older races with a penalty, the first came after the 4th warning, counted together. Task 6b of the plan lists, over every recording, each penalty with the game's two warning counters at that moment (all warnings, and corner-cutting warnings alone) and the penalty's infringement, and adds that table here before you answer.

**Evidence (Task 6b, `pnpm pitwall scan-situations --warnings recordings/`, 18 recordings, 2026-11-05).** Every penalty of the player car, with the warned span it belongs to (projection membership, C26). Infringement names from the F1 25 data-output appendix.

| Recording | Phase | Penalty | Infringement | Warnings (all) | Corner-cutting |
|---|---|---|---|---|---|
| 2026-10-29_00-04-08 | race | time penalty | 21 Multiple warnings | 4 | 3 |
| 2026-10-30_15-20-41 | race | time penalty | 21 Multiple warnings | 4 | 3 |
| 2026-10-30_18-53-00 | race | drive-through | 38 VSC exceeding allowed pace | 4 | 2 |
| 2026-10-30_18-53-00 | race | time penalty | 21 Multiple warnings | 5 | 3 |

Timing (a per-race probe of the spans): each "multiple warnings" penalty came one frame after the warned span of the 3rd corner-cutting warning opened (frames 50387→50388, 227529→227530, 64989→64990); a 4th corner-cutting warning (two races) brought no second penalty; six collision warnings (infringement 4) in one race brought none.

Per weekend phase (every recording): practice reached 9 corner-cutting warnings (2026-10-30_18-26-27) and 4 (tonight) without a penalty; qualifying at most 2 (so no evidence either way); races: the penalty at the 3rd, three times out of three. FIA practice (research 2026-11-05, user: F1 25 follows that year's FIA rules closely): in practice and qualifying a track-limits offence deletes the lap time; in the race warnings 1–2, the black-and-white flag on the 3rd, 5 s on the 4th, 10 s on the 5th. The game's counter reads 3 at the penalty, one step before FIA's 4th: either the game penalises the 3rd cut, or its counter counts the flagged and the penalised offence as one; the telemetry has no black-and-white-flag field to tell them apart.

No penalty in any practice, qualifying, sprint or tonight's sessions (tonight's race ended at 2 warnings, 1 of them corner cutting). Every "multiple warnings" penalty came with the 3rd corner-cutting warning, while the total stood at 4 or 5; the one penalty at another count (the drive-through) was for the VSC pace, not for warnings.

- **A.** Count only corner-cutting warnings; the limit is whatever Task 3a's table shows (3 if the penalties follow the 3rd corner-cutting warning); the alarm in races only (qualifying added once a recording shows a qualifying penalty).
- **B.** Count every warning, as now, with the limit from the table; races only.
- **C.** No "last warning" alarm; the incident feed shows each warning with its kind.

Recommendation: **A** with limit 3: the "one warning left" alarm when the corner-cutting count reaches 2, in races only. The table fits it on all three warning penalties; counting every warning (B) would have needed a limit of 4 in two races and 5 in the third.

**Answer:** races only, corner-cutting warnings only, the "one cut left before a penalty" alarm at the 2nd (the 3rd brought the penalty in every race); practice and qualifying get no last-warning alarm (a cut there costs the lap, which lap validity shows); collision warnings show their kind without n/3 (user, 2026-11-05, after the FIA research and the per-phase table).

## Q5. Should the teammate get a pressure band too?

The setup-based pressure band (Q3) needs the car's setup. pitwall reads the setup only for the player's car (`ownCar`), so the teammate's and every rival's pressure band would be unknown. The game's Setups packet does hold a row per car, but in tonight's race cars 0, 4, 7 (the AI teammate) and 19 (the player) all carry the same 20.9 / 20.9 / 24.2 / 24.2 psi. That looks like a copy, not each car's real setup. Reading other cars' setups would be an adapter change (step 1), and realism would then have to hide the rivals' setups there (C8).

- **A.** Player only now: the teammate's and rivals' pressure bands stay unknown. Revisit once a recording with a human teammate shows whether the game sends real setups for other cars.
- **B.** Read every car's setup in step 1 now (realism hiding rivals'), and give the teammate a band from it, even if the values may be copies.
- **C.** Teammate and rivals get the fixed band they have today (20–31 psi).

Recommendation: **A** (built): it shows no band from data that looks wrong.

**Answer:** A, own car only for now (user, 2026-11-05).

## Also decided (user, 2026-11-05)

- The per-mini-sector battle pace delta waits for the SP4a re-spec.
- Execution: subagent-driven. Plan reviewed by a second session, clean under C89 (e932c95). **Go given (user, 2026-11-05): the next agent starts the run** (a new session, from the handoff in `.superpowers/sdd/2026-11-05-live-test-fixes/handoff.md`).
- "Update and send as often as it stays correct" stays a spec rule for now, not a contract clause.
