# Live-test fixes: questions for the user

Four decisions the plan (`2026-11-05-live-test-fixes.md`) needs. Each names the option the plan builds if you have no answer. The evidence is in `docs/acceptance/live-checklist.md`, section "2026-11-04/05".

## Q1. Which laps should the tyre and brake band alarms judge?

On lap 1 of the race and on the safety-car laps, cold tyres raised up to nine advisories at once and two critical "out for the whole lap" alarms. Everyone knows tyres are cold then. The AI teammate (Russell) reads a flat 90 °C carcass on every corner for most of the race, so its tyre bands mean little.

- **A.** Judge only rate laps that are not lap 1 of a race: no in-lap, out-lap, safety-car or VSC lap (the `forRate` class `fuel` and `pace` already use), and not lap 1. The live band colours stay as they are; only the lap judgement and its alarms skip those laps. AI cars stay judged.
- **B.** As A, and no band alarms for an AI-driven car. **This needs a contract change:** whether a car is AI-driven is the `aiControlled` signal, which only the machine reads (C12, C13), and no sub-machine turns it into a situation yet. It would add a sub-machine (car control: human or AI) to the inventory (C17).
- **C.** Keep judging every lap, but only raise the alarm on the second lap in a row out of band.

Recommendation: **A** now (built), B later as its own contract change if the AI alarms still bother you.

**Answer:** A (user, 2026-11-05).

## Q2. How should the carcass band's two levels show and alarm?

Your friend's ranges for the slick carcass: below 70 °C too cold, 70–80 okay, 80–100 good, 100–105 okay, above 105 too hot. Today the band has one level (75–110 °C): inside is plain, outside is amber, and a whole lap outside is a critical alarm. Your colour rule is grey unless something needs attention.

- **A.** Good and okay both plain (grey); amber and the advisory only outside okay (below 70, above 105); critical for a whole lap outside okay. The "good" range is shown as the band's inner mark in the corner block, so you see where the sweet spot is.
- **B.** Good plain, okay amber (no alarm), outside okay red with the advisory; critical for a whole lap outside okay.
- **C.** As B, and the advisory already on a whole lap in "okay".

Recommendation: **A** (built). It keeps 70 °C uncoloured, as you asked, and still shows the target.

Only the slick carcass gets two levels. Surface, brakes, engine, the intermediate and wet carcass keep their one band until you give ranges for them.

**Answer:** A (user, 2026-11-05). Also confirmed: 100–105 °C is okay, not good.

## Q3. What should the tyre pressure band be?

The band is one fixed range, 20–31 psi, for all four tyres. Your friend's setup is 20.9 psi rear and 24.2 psi front. Warm, the live pressure sits at the setup value: in practice rear 19.7–21.5 psi (p5–p95), front 22.6–24.9. Cold (race start, safety car) the rears fell to 18.8. The game sends our cars' setup pressures; for rivals, realism hides them.

- **A.** Per corner, relative to the car's own setup pressure: in band from setup − 1.5 psi to setup + 1.0 psi (tonight's spread, pitwall estimate). With realism hiding a rival's setup, its pressure band is `unknown('realism')`.
- **B.** Per axle, fixed: front 22–26 psi, rear 19–23 psi (from tonight's data, one driver, one track).
- **C.** No pressure band alarm; show only the difference to the setup pressure.

Recommendation: **A** (built): it follows any setup and any track.

**Answer:** the user has no view yet ("do as you think fits for now, I'll fix it once I understand more about it", 2026-11-05). Built: A, provisional; the offsets are config with a pitwall-estimate source note, so changing them later is a config edit.

## Q4. Which warnings lead to a penalty, and in which sessions?

The "one warning left before a penalty" alarm counts every warning together and fires in every session. Tonight's race: warning 1 was corner cutting, warning 2 a small collision. The game then counted 2 warnings, 1 of them corner cutting. In practice warnings never led to a penalty (4 warnings tonight, 9 in an older practice). In the three older races with a penalty, the first came after the 4th warning, counted together. Task 3a of the plan counts, over every recording, which warnings came before each penalty, split by kind, and adds that table here before you answer.

- **A.** Count only corner-cutting warnings; the limit is whatever Task 3a's table shows (3 if the penalties follow the 3rd corner-cutting warning); the alarm in races only (qualifying added once a recording shows a qualifying penalty).
- **B.** Count every warning, as now, with the limit from the table; races only.
- **C.** No "last warning" alarm; the incident feed shows each warning with its kind.

Recommendation: **A**, pending the table (built only after your answer).

**Answer:** open until Task 6a's table is here.

## Also decided (user, 2026-11-05)

- The per-mini-sector battle pace delta waits for the SP4a re-spec.
- Execution: subagent-driven. **No go yet**: the user reviews the plan first.
- "Update and send as often as it stays correct" stays a spec rule for now, not a contract clause.
