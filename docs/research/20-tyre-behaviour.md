# 20. Tyre behaviour: heat, pressure and track condition

2026-11-14. How tyres behave with surface and carcass temperature, pressure and track condition (track temperature, evolution, wet, damp, drying): in real F1, in the F1 25 game, and in our own recordings; and what that means for `car-bands`, wear prediction, a setup check and the crossover. Written after the Silverstone live test of 2026-11-14 (`docs/acceptance/live-checklist.md`, "2026-11-14: live test notes").

**Sources and labels.** Real-F1 facts carry their URL. Game facts cite the UDP spec (`external/F1 25 Telemetry Output Structures.txt`, cited "Structs.txt:line"; `external/Data Output from F1 25 v3-1.pdf`, cited "PDF, section") or a URL. Recording facts come from a throwaway spike in the session scratchpad, `/tmp/claude-1000/-home-nklx-dev-personal-pitwall/920b5a33-0c6c-4ebb-ace7-acdbabd0122b/scratchpad/tyre-spike/` (cited `spike/<script>`; the scratchpad can be cleared, this file keeps the results). The spike decodes every recording of 5 MB or more in `recordings/` and `~/.local/share/pitwall/recordings/` (55 recordings, 869,195 car-samples at 1 Hz of session time, 6,777 car-laps; flashback-undone samples dropped) with `packages/protocol`. **[13-inch]** marks a real-F1 figure from before 2022. **Thin** marks a number on too few cases to be more than a hint. Everything in §7 is a proposal for the user to decide, not a ruling.

Who drove: Ferrari cars mainly DR, Mercedes cars mainly Asymetrisch (research 12 §1). The Silverstone race of 2026-11-14 (car 19) is DR.

## 1. Findings that matter for pitwall

1. **The game's tyre pressure is the gas law on the setup pressure.** `psi = setupPsi × (inner + 273.15) / (Tref + 273.15)`, with a reference carcass temperature Tref per actual compound: C1 105, C2 95, C3 90, C4 85, C5 80, inter 65, wet 55 °C. Error p5–p95 within ±0.08 psi over 41k player samples in 41 files (`spike/warm.py`). So a setup pressure is the hot pressure at Tref, and **live pressure adds nothing beyond the carcass temperature**.
2. **AI tyre temperatures and pressures are constants.** AI carcass sits at Tref of its compound (98–99 % of samples on C3), the AI surface at one value per compound, AI pressure at one value per track (the game's default setup), whatever the compound. Other humans online also show a constant default pressure. Only our own cars' (and other humans') temperatures are simulated (`spike/variance.py`). **AI tyre temperatures and pressures carry no information**; AI wear does respond to compound, track and drying.
3. **One slick carcass band of 70–105 °C is right only for C3 and C2.** The ideal moves with the compound by 25 °C (C5 80 → C1 105). A per-compound band around Tref fits the data and the game's own model.
4. **On inters, wear rises with carcass heat above Tref:** +0.042 ± 0.004 %/lap per °C within a stint (404 corner-laps). On slicks no within-stint relation is measurable.
5. **Silverstone 2026-11-14: the drying track raised everyone's wear, and car 19's twice as much.** AI inters ×1.4 (1.22 → 1.67 %/lap, flat AI temperatures), car 19 ×2.0 (1.86 → 3.71 %/lap) with its rear carcass at Tref +30…40 °C. The data do not show the setup pressure as a cause: the pressure rose because the carcass heated.
6. **Track wetness is not in the feed.** No wetness, rubber or dry-line field exists; weather, rain % and track temperature are all there is. At Silverstone the forecast said 76–78 % rain to the end while lap times said drying. Lap times per tyre type are the drying signal (as research 12 §3 found).
7. **Blisters are 0 in every sample of every recording**, and `tyresDamage` equals round(wear). Neither adds a signal today.
8. **Real F1 matches the game's structure, not its numbers.** Real teams also judge the bulk (carcass), not the surface; real windows are about 30 °C wide and sit higher for harder compounds; real pressures follow the gas law. No public source gives degradation per °C of track temperature or per psi, in real F1 or the game.

## 2. Real F1: temperature and track

**Surface, bulk, liner.** Teams measure the tread surface (IR) and the inner liner (sensor on the valve); the bulk, which sets the rubber's grip and degradation, is estimated between the two ([Autosport, Symonds 2024](https://www.autosport.com/f1/news/why-peak-tyre-temperature-is-an-elusive-state-for-f1-cars-to-attain/10680110/); [Autosport, Isola 2024](https://www.autosport.com/f1/news/the-peak-grip-tyre-secrets-that-are-key-to-f1s-qualifying-battle/10605645/)). Rubber conducts heat about 1,500 × worse than aluminium, so the surface reacts within a corner and the bulk over laps (Symonds, same).

| Figure | Value | Source |
|---|---|---|
| Typical peak grip | ~105 °C; 1 % less below 100 or above 115 °C | [Symonds](https://www.autosport.com/f1/news/why-peak-tyre-temperature-is-an-elusive-state-for-f1-cars-to-attain/10680110/) |
| Cost of 1 % grip | ~0.3 s/lap (≈ 10 kg fuel) | same |
| Working range | within 3 % of peak grip, ~30 °C wide | [Isola 2024](https://www.autosport.com/f1/news/the-peak-grip-tyre-secrets-that-are-key-to-f1s-qualifying-battle/10605645/); [Pirelli 2017](https://www.pirelli.com/global/en-ww/race/seeing-through-the-window) [13-inch] |
| 2019 windows [13-inch] | C1 110–140, C2 110–135, C3 105–135, C4 90–120, C5 85–115 °C | [Pirelli 2019](https://press.pirelli.com/whats-new-with-pirellis-2019-formula-1-tyres/) |
| Cooling on a straight | Baku −30 °C over the straight; Las Vegas fronts −35…40, rears −20…25 °C | [Isola 2024](https://www.autosport.com/f1/news/the-peak-grip-tyre-secrets-that-are-key-to-f1s-qualifying-battle/10605645/); [F1 Chronicle](https://f1chronicle.com/what-is-graining-in-formula-1/) |

Pirelli has published no per-compound windows for the 18-inch tyre (2022–2026). The 2019 order holds in the game too: the harder the compound, the higher its ideal.

**Out of the window.** Four phenomena with different triggers:

| Phenomenon | Trigger | Where | Reversible | Source |
|---|---|---|---|---|
| Graining | loading a cold tread: it shears and rolls | fronts, cold or green tracks, early stint | yes, over several laps if the tyre warms | [Symonds](https://www.autosport.com/f1/news/why-peak-tyre-temperature-is-an-elusive-state-for-f1-cars-to-attain/10680110/); [F1 Chronicle](https://f1chronicle.com/what-is-graining-in-formula-1/) |
| Overheating | surface sliding (pushing, wheelspin, dirty air) | surface far above bulk | yes, with driving or weather | [Pirelli, Bahrain 2025](https://press.pirelli.com/in-bahrain-with-prior-knowledge/) |
| Thermal degradation | enough energy to change the tread's bonds | rears on traction tracks; the main limit of the 18-inch era | no | same |
| Blistering | bulk too hot; gas bursts the surface | thick tread, hot track | no, usually a stop | [Symonds](https://www.autosport.com/f1/news/why-peak-tyre-temperature-is-an-elusive-state-for-f1-cars-to-attain/10680110/); [Motorsport.com, Austria 2018](https://www.motorsport.com/f1/news/pirelli-surprised-by-tyre-blistering-in-austria-1054753/3133852/) [13-inch] |

Wear inside the window is "relatively consistent" and near linear; graining and blistering give sudden non-linear loss ([Catapult](https://www.catapult.com/blog/how-tyre-degradation-affects-race-strategy)).

**Track temperature.** Tracks swing 10–15 °C between sessions (Bahrain 2025 ~50 °C in FP1, ~15 °C lower in the evening, [The Race](https://www.the-race.com/formula-1/bahrain-gp-pirelli-tyre-pressures/); Imola 2024 50 → 39 °C, race 52.5 °C, [Pirelli](https://press.pirelli.com/leclerc-throws-down-the-gauntlet-in-imola-0/)). Hot means rear thermal degradation (Hungaroring 2024, 58.6 °C, [F1Technical](https://www.f1technical.net/news/27513)); cold means front graining (Las Vegas). A few degrees can tip a tyre into blistering (Silverstone 2020, [Motor Sport](https://www.motorsportmagazine.com/articles/single-seaters/f1/mph-why-mercedes-keeps-struggling-to-get-its-tyres-to-work), [13-inch]). **No public source gives degradation per °C of track.** The TUM race simulation has no temperature term at all: tyre loss is a function of age and compound ([Heilmeier et al. 2020](https://doi.org/10.3390/app10124229)).

**Evolution.** Rubber on the racing line raises grip through a weekend; rain or a new surface resets it to green (more sliding, more graining). Only anecdotes give sizes: up to ~2 s/lap after rain ([Flow Racers](https://flowracers.com/blog/green-track-f1/), secondary), 5.3 s from FP1 to pole on a new circuit (Korea 2010, [PitPass](https://www.pitpass.com/44927/)). Pirelli rates tracks on abrasion, grip, traction, braking, lateral load, stress and evolution ([Pirelli racingspot](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/formula-1-for-dummies-the-choice-of-tyres-in-formula-1-53864/)); those ratings say which axle limits.

**Driver.** Sliding is the lever: pushing, wheelspin, lock-ups and dirty air overheat the surface; smooth driving and clean air let it recover ([Pirelli 2025](https://press.pirelli.com/in-bahrain-with-prior-knowledge/); [Motorsport.com](https://www.motorsport.com/f1/news/pirelli-new-f1-tyre-plan-2025-address-overheating-problems/10589071/)). No public figure says how much a driver changes the wear rate.

## 3. Real F1: pressure

Pirelli prescribes a minimum starting pressure per axle and tyre type for each event, at a 70 °C tyre, with a cooling curve for colder tyres: `P = (T − 70) × k + Pstart` ([FIA, Monaco 2025 Pirelli preview](https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_event_notes_-_pirelli_preview.pdf)).

| Event | Slick F / R | Inter F / R | Wet F / R | Stabilised running F / R | k F / R (psi/°C) | Source |
|---|---|---|---|---|---|---|
| Dutch 2023 | 24.0 / 21.0 | 25.0 / 22.0 | 23.0 / 20.0 | ≥ 26.5 / 23.5 | 0.119 / 0.111 | [FIA](https://www.fia.com/sites/default/files/decision-document/2023%20Dutch%20Grand%20Prix%20-%20Event%20Notes%20-%20Pirelli%20Preview.pdf) |
| British 2024 | 26.5 / 23.5 | 27.5 / 25.0 | 24.5 / 22.0 | ≥ 28.5 / 25.5 | 0.128 / 0.119 | [FIA](https://fia.com/sites/default/files/decision-document/2024%20British%20Grand%20Prix%20-%20Event%20Notes%20-%20Pirelli%20Preview.pdf) |
| Abu Dhabi 2024 | 22.5 / 21.0 | 22.5 / 22.0 | 20.5 / 20.0 | ≥ 25.0 / 23.5 | 0.117 / 0.112 | [FIA](https://www.fia.com/sites/default/files/decision-document/2024%20Abu%20Dhabi%20Grand%20Prix%20-%20Event%20Notes%20-%20Pirelli%20Preview.pdf) |
| Monaco 2025 | 20.0 / 19.0 | 20.5 / 20.0 | 18.5 / 17.0 | ≥ 21.5 / 20.5 | 0.111 / 0.108 | [FIA](https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_event_notes_-_pirelli_preview.pdf) |
| Belgian 2026 | 28.0 / 28.0 | 29.5 / 27.5 | 27.5 / 25.0 | slick ≥ 28.5 / 28.5 | 0.133 / 0.133 | [FIA](https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_competition_notes_-_pirelli_preview.pdf) |

What the table says:
- Minimums scale with track energy: Monaco 20/19, Silverstone and Spa 26.5–28 psi. Front above rear by 1–3.5 psi until 2025; equal at Spa 2026.
- Inters sit 0.5–1.5 psi above slicks, wets 1.5–3 psi below (2023–2025, when wets had no blankets).
- The cooling-curve slopes, 0.108–0.133 psi/°C, are the gas law on absolute pressure: (P_gauge + 14.7) / (T + 273) gives 0.101–0.120 at 20–26.5 psi and 70 °C (own calculation).
- Running pressure is only 0.5–2.5 psi above the 70 °C minimum, so the gas runs at roughly 75–95 °C (inference, not a published figure).

**Why the minimum is binding.** Lower pressure gives a bigger contact patch, more grip and a cooler patch, but more carcass flex and sidewall fatigue (the Baku 2021 failures, [The Race](https://www.the-race.com/formula-1/why-f1-teams-want-to-run-lowest-tyre-pressures-they-can.md)); higher pressure gives a smaller patch, more sliding and overheating ([The Race, Bahrain 2025](https://www.the-race.com/formula-1/bahrain-gp-pirelli-tyre-pressures/); [Motor Sport](https://motorsportmagazine.com/articles/single-seaters/f1/not-too-hot-not-too-cold-f1-teams-search-for-the-pirelli-tyre-sweet-spot)). Teams run at the minimum. Pirelli raises it when telemetry shows higher loads ([Autosport, Turkey](https://www.autosport.com/f1/news/pirelli-increases-minimum-f1-tyre-pressures-ahead-of-turkish-gp-4977290/4977290/)) and lowered it once when heat pushed the running pressure too high (Bahrain 2025 rear 21 → 20, The Race, same).

**No published F1 figure for lap time or wear per psi.** Other series: Formula E expected ~0.3 s/lap from 1.45 psi lower ([The Race](https://www.the-race.com/formula-e/formula-e-teams-get-late-tyre-pressure-curveball-from-michelin.md)); sim coaches say tenths per psi off optimum ([Coach Dave](https://coachdaveacademy.com/tutorials/understanding-tire-pressures-in-iracing/)).

## 4. Real F1: wet, damp, drying

| Figure | Value | Source |
|---|---|---|
| Water cleared at 300 km/h | inter ~35–40 L/s per tyre, wet ~85 L/s | [Pirelli 2020](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/when-it-s-time-to-change-from-slick-to-wet-tyres-in-formula-1-52943/); [Motorsport.com 2025](https://www.motorsport.com/f1/news/what-pirelli-wants-to-change-about-the-f1-tyre-nobody-ever-uses-/10735569/) |
| Slick → inter crossover | 110–112 % of the dry lap | [Pirelli 2020](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/when-it-s-time-to-change-from-slick-to-wet-tyres-in-formula-1-52943/); [Motorsport.com 2025](https://www.motorsport.com/f1/news/what-pirelli-wants-to-change-about-the-f1-tyre-nobody-ever-uses-/10735569/) |
| Inter → wet crossover | ~118 % (2025 wet; target 115–116 %, older wet ~120 %) | [Motorsport.com 2025](https://www.motorsport.com/f1/news/what-pirelli-wants-to-change-about-the-f1-tyre-nobody-ever-uses-/10735569/); [Autosport 2025](https://www.autosport.com/f1/news/Why-drivers-rarely-use-F1-wet-tyres/10743379/) |
| Inters on a track ready for slicks | 5–6 s/lap lost | [Pirelli 2020](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/when-it-s-time-to-change-from-slick-to-wet-tyres-in-formula-1-52943/) |

- **The wettest corner decides.** A track 75 % dry can still be too wet for slicks ([Mercedes](https://www.mercedesamgf1.com/news/how-the-weather-challenges-f1)). Singapore 2022 stayed split for about half the race; Russell's stop for slicks set the fastest lap and triggered the field's switch ([Motor Sport](https://motorsportmagazine.com/archive/article/december-2022/36/switching-from-inters-to-slicks-the-crucial-strategic-tyre-call-in-f1-wet-races)).
- **Inters on a drying track** overheat, grain and wear their grooves away until they behave like a slick (Turkey 2021, one set for a whole race, [Motorsport Week](https://www.motorsportweek.com/2021/10/10/pirelli-warned-teams-over-full-race-distance-on-intermediate-tyres/)). The 2025 inter was revised to overheat less ([F1Technical](https://www.f1technical.net/news/26459)); the 2026 inter has the opposite problem, it does not warm up ([The Race](https://www.the-race.com/formula-1/f1-divisive-wet-weather-tyres-to-change-in-2027-what-we-know.md)). The inter's window is generation-specific.
- **Wets** overheat and degrade fast outside near-red-flag conditions; used once in 2025 ([Motorsport.com 2025](https://www.motorsport.com/f1/news/what-pirelli-wants-to-change-about-the-f1-tyre-nobody-ever-uses-/10735569/)).
- Slicks fitted too early on a damp track can "spiral": they never reach temperature ([Autosport](https://www.autosport.com/f1/news/f1-drivers-could-face-spiral-into-misery-in-wet-dry-imola-race/10172075/)).
- **Gaps:** no published drying rate, no numeric inter or wet temperature windows, no wear rate per lap against wetness.

## 5. The F1 25 game: model and feed

**Feed fields** (all cars unless noted):

| Field | Packet, rate | Unit, resolution | Source |
|---|---|---|---|
| `m_tyresSurfaceTemperature[4]`, `m_tyresInnerTemperature[4]` | CarTelemetry, menu rate (37–60 Hz in our files) | °C, whole degrees (u8) | Structs.txt:228–229 |
| `m_tyresPressure[4]` | CarTelemetry | psi, float | Structs.txt:231 |
| `m_surfaceType[4]` (8 = water) | CarTelemetry | per wheel | Structs.txt:232 |
| `m_tyresWear[4]`, `m_tyresDamage[4]`, `m_tyreBlisters[4]` | CarDamage, 10 Hz | %; wear float but whole percent in practice | Structs.txt:300–303 |
| `m_actualTyreCompound`, `m_tyresAgeLaps` | CarStatus | C0–C6, inter, wet | Structs.txt:273, 280 |
| setup pressures per wheel | CarSetups, 2 Hz; own car only online | psi | Structs.txt:170–195; PDF "Car Setups Packet" |
| tyre sets (wear, life, `m_lapDeltaTime`) | TyreSets | % , laps, ms | Structs.txt:350–373 |
| weather, track and air temperature, forecast with rain % | Session, 2 Hz | °C, % | Structs.txt:67–105 |
| `m_tyreTemperature` (0 surface only, 1 surface and carcass) | Session | setting | Structs.txt:127 |

- **Restricted human cars online** send zero wear, damage and tyre sets, but temperatures and pressures are not on the restricted list (PDF "Restricted data").
- **Not in the feed:** track wetness, standing water (beyond a wheel on "water"), rubber, the dry line, tread-width (inner/middle/outer) temperatures.

**The model, from EA.** EA's statements are qualitative only:
- F1 24: a "brand new" temperature model with separate surface and carcass variation by pressure, conditions and style ([EA F1 24 deep dive](https://www.ea.com/news/f124-gameplay-deep-dive), search snippet); wet sections cool the tyres, and the wet line keeps inters from overheating as the track dries ([RacingGames.gg](https://racinggames.gg/f1/f1-24-physics-and-handling-changes)).
- F1 25: revised tyre loads and slip model; aggressive driving overheats and wears; wear "recalibrated for each tyre compound, with track-specific details playing a larger role"; drying lines form differently ([EA F1 25 deep dive](https://www.ea.com/games/f1/f1-25/news/f1-25-advancements-deep-dive)).
- No EA number for grip against temperature, the pressure effect, or blisters. Wear per track and compound must be calibrated from recordings.

**Community windows** (F1 23/24 era) disagree by about 10 °C: per-compound carcass optima C1 100, C2 95, C3 90, C4 90 °C ([SimRacingSetup F1 24](https://simracingsetup.com/f1-24/f1-24-ideal-tyre-temperatures/)); "94–104 °C" ([SimRacingSetup F1 23](https://simracingsetup.com/?p=6840879)). The F1 24 C1–C3 optima match the Tref values our recordings show (§6) within 5 °C. Our recordings are better evidence for F1 25 than any web table.

**Pressure and wear, community.** One F1 25 anecdote: +2 psi on all four cut wear from 21 % to 16 % over five laps ([GTPlanet](https://www.gtplanet.net/forum/threads/f1-25-general-discussion.431363/post-14474857), snippet); an older view: low pressure wears by abrasion, high by heat ([EA forum, F1 22](https://forums.ea.com/discussions/f1-games-franchise-discussion-en/tyre-pressure--temps-really-matter-on-f1-22/8444739)). Contested and unverified.

**AI tyres.** A bug report says AI temperatures are constant (inters and wets 65, slicks 90 °C) ([EA forum](https://forums.ea.com/idea/f1-25-bug-reports-en/no-tire-temperature-simulation-for-ai-cars/12678109), snippet); a reply calls it a limit of every Codemasters F1 game. Our recordings confirm it and refine it (§6).

## 6. What our recordings show

### Human tyre temperatures

Player, green racing samples (pit status 0, no SC/VSC, > 60 km/h, tyre age ≥ 1), race sessions, p5 / p50 / p95 (`spike/dist.py`):

| Compound | Car-sessions | Inner RL | Inner FL | Surface RL | Surface FL |
|---|---|---|---|---|---|
| C1 | 2 | 89 / 97 / 105 | 82 / 89 / 104 | | |
| C3 | 16 | 87 / 96 / 103 | 76 / 89 / 95 | 56 / 76 / 96 | 43 / 69 / 110 |
| C4 | 4 | 83 / 92 / 95 | 78 / 83 / 91 | | |
| inter | 4 | 60 / 71 / 101 | 55 / 61 / 87 | 34 / 48 / 84 | 28 / 39 / 63 |
| wet | 2 (thin) | 55 / 66 / 77 | 51 / 59 / 63 | 32 / 40 / 50 | 29 / 35 / 42 |

- Fronts run 5–10 °C colder carcass than rears on slicks, about 10 °C on inters.
- The human carcass centre moves with the compound: C1 rear p50 97, C3 96, C4 92 °C.

### AI and other humans: constants

All AI cars, 463k samples (`spike/variance.py`):

| Compound | AI surface (share at the mode) | AI inner (share) |
|---|---|---|
| C1 | 110 (62–90 %) | 105 (72–79 %) |
| C2 | 100 (93–99 %) | 95 (95–97 %) |
| C3 | 90 (99 %) | 90 (98–99 %) |
| C4 | 85 (92–94 %) | 85 (90–93 %) |
| C5 | 80 (100 %) | 80 (100 %) |
| inter | ≤ 70 (31–68 % at 70) | 65 (99 %) |
| wet | ≤ 50 (54–59 % at 50) | 55 (96–99 %) |

- AI inner sd per stint 0.00–0.25 °C on C2–C5 and inters, against 1.9–3.8 °C for humans. AI pressure sd 0.00 on every compound.
- The AI wet-tyre surface moves only below its cap, and only in the storm races (Mexico, Miami).
- AI pressure is one constant per track, whatever the compound: 20.9 / 24.2 psi (rear / front) at Singapore, Zandvoort, Mexico, Texas; 21.3 / 24.2 at Shanghai, Suzuka, Silverstone; 21.5 / 24.3 at Miami and Spa. These equal the default setup the Setups packet shows before a player's setup loads (`spike/warm.py`).
- Three other humans online (Zandvoort `2026-10-29_22-39-31` car 1, `2026-10-29_23-00-37` car 0; Suzuka `2026-11-10_23-22-46` car 0): temperatures vary (inner sd 3.3–6.9 °C), pressure is constant at the track default.
- Time trial: surface = inner = one constant on all four corners (93 or 97 °C).
- 86 % of moving AI samples are unchanged over 1 s, against 5 % for humans (`spike/misc.py`).

So the AI is shown permanently at the compound's ideal; the "flat 90 °C" in the live checklist is C3's value.

### Pressure is setup × gas law

Implied Tref = (inner + 273.15) × setup / psi − 273.15, all moving player samples, p5 / p50 / p95 (`spike/warm.py`):

| Compound | Tref (°C) | Samples | Files |
|---|---|---|---|
| C1 | 104.0 / 104.5 / 105.0 | 6,651 | 9 |
| C2 | 94.0 / 94.5 / 95.0 | 2,767 | 7 |
| C3 | 89.0 / 89.5 / 90.0 | 13,390 | 40 |
| C4 | 84.0 / 84.5 / 85.0 | 3,505 | 7 |
| C5 | 79.1 / 79.5 / 80.0 | 881 | 3 |
| inter | 64.1 / 64.5 / 65.0 | 12,415 | 4 |
| wet | 54.1 / 54.5 / 55.0 | 1,370 | 2 |

- The 0.5 °C offset is the truncation of the u8 inner temperature. With Tref = the AI value, the error is +0.00 / +0.03 / +0.07 psi on every compound.
- Slope of psi on inner: 0.073 psi/°C at setup 26.5, 0.052–0.058 at 20.5–20.9, 0.069 at 23.5 (Silverstone inters): setup / (Tref + 273.15). That is about half the real-F1 slope (0.108–0.133, §3): the game scales the gauge pressure, while a real tyre follows the absolute pressure (gauge + 14.7 psi).
- **Warm-up** from pit exit to within 0.2 psi of settled: fresh slicks leave at inner 69–70 °C (inters 59–60) and 1.2–2.5 psi below settled; settled after 2.7–5.7 min (2–4 laps) at Singapore, Zandvoort, Spa, Suzuka and the Texas race; 12–15 min on Spa C1 and Silverstone inters, where the carcass kept heating as the track dried.
- **Quirks:** the first samples of a stint often show the track-default pressure at inner 70 °C whatever the setup; the Setups packet's first sample can be the default setup (`2026-10-29_22-39-31`: real setup at 46 s).

**A correction to the live checklist.** "The live value sits at the setup value once warm" (car-bands config comment, live test 2026-11-04/05) holds only when the carcass is at Tref. It looked true at Texas because the C1 carcass ran near 105 °C (RL p50 −0.08 psi). At Silverstone (setup 23.5 / 29.5) car 19's rears ran above setup all race: C2 +0.4 to +1.0, inters +0.7 to +2.9 psi.

Player setups seen (`spike/warm.py`):

| Recording(s) | Track | Driver | Setup rear / front (psi) |
|---|---|---|---|
| `2026-10-28_23-53-34`, `2026-10-29_00-04-08` | Singapore | DR | 26.5 / 27.0 |
| `2026-10-29_23-00-37` car 1 | Zandvoort | DR | 26.5 / 29.5 |
| `2026-10-30_15-20-41` | Mexico | Asymetrisch | 26.5 / 29.5 |
| `2026-10-30_18-26-27`, `18-53-00` | Miami | friend's game | 20.5 / 29.5 |
| `2026-11-02_15-17-14` | Shanghai | DR | 20.5 / 29.5 |
| 2026-11-04/05 | Texas | Asymetrisch | 20.9 / 24.2 (the default setup) |
| 2026-11-06/07/10 | Suzuka | | 20.5 / 28.0 |
| `2026-11-12_02-21-24` | Spa | | 26.5 / 29.5 |
| `2026-11-13_23-41-39`, `2026-11-14_00-04-26` | Silverstone | DR | 23.5 / 29.5 |

Rear 20.5–26.5, front 24.2–29.5 psi; 26.5 rear and 29.5 front are the highest seen. The game's slider limits are not in the spec.

### Wear against heat, pressure, track

- **Inters: wear rises with carcass above Tref.** Within corner-stint fixed effects (rate ~ overheat + age): +0.0423 ± 0.0043 %/lap per °C (404 corner-laps, 28 corner-stints); equivalently +0.52 ± 0.06 %/lap per psi above setup (`spike/weartemp.py`).

  | Inter overheat (inner − Tref) | Rate (corner-laps) |
  |---|---|
  | −10…−5 °C | 0.51 %/lap (93) |
  | −5…0 | 0.73 (62) |
  | 0…5 | 1.16 (112) |
  | 5…10 | 1.30 (50) |
  | 10…15 | 1.88 (26) |
  | 15…25 | 2.05 (37) |
  | 25…60 | 3.22 (18) |

- **Slicks: no within-stint relation** (−0.014 ± 0.014 per °C, 552 corner-laps); across stints corr 0.54 over 12 stints (thin).
- **Setup pressure alone: not measurable.** No session changes it while running; across sessions it is confounded with track and driver (slicks corr 0.13; inters −0.99 over 6 stints, all from Miami's low 20.5 setup).
- **Track temperature within a stint: not measurable** (slick −0.051 ± 0.031 %/lap per °C; changes are 1–2 °C in integer steps; `spike/misc.py`).
- **Humans wear inters 1.3–2.1 × the AI** in the same race: Mexico 1.7 ×, Singapore 1.3 ×, Miami 1.6 ×, Silverstone 2.1 × (`spike/wear.py`), in line with research 12 §3's 1.4–2.0 × on slicks.
- Worst corner is a rear on most stints; DR's Shanghai C3 and the Texas human stints wore a front fastest (FL 5.88 and 6.17 %/lap).

### Following, pushing

- **Following has no measurable effect on slicks** (≤ 0.3 °C, nothing on pressure or wear). On wet tyres the surface is 2–2.5 °C cooler within 1 s of a car than more than 4 s back; the carcass does not change (`spike/misc.py`).
- Pushing within a stint: per 1 s faster lap, slick inner +0.5 °C, surface +0.4 °C, wear +0.04 %/lap; wet tyres +0.06 %/lap.
- All of this is small against band widths and against the 20–40 °C drying effect.

### Blisters, damage, rounding

- `tyreBlisters` is 0 in all 869,195 samples on all four corners, for AI, player and other humans, up to 56 % wear and inter carcass 106 °C. Whether restricted cars zero it cannot be tested.
- `tyresDamage` = round(wear) in 99.97–100 % of samples; 100 on a puncture.
- `m_tyreTemperature` is 1 (surface and carcass) in all 55 recordings; setting 0 is untested.
- Wear is whole percent (field f32, values integer), so a per-lap rate carries ±1 % quantisation; rates need several laps.

## 7. Consequences for pitwall

### 7.1 Car bands: a calibration proposal (for the user to decide)

Current `car-bands` defaults (`packages/analysis/src/car-bands/config.ts`), judged on the lap's mid-range (min + max) / 2:

| Band | Today | Measured, player lap mid-ranges p5–p95 (`spike/midrange.py`) | Fit |
|---|---|---|---|
| Slick carcass | 70–105 | rear 88–104.5, front 79–101; centre moves with compound | right for C3 and C2 only |
| Slick surface | 55–100 | rear 70–85.5, front 67–95.4 | fits |
| Inter carcass | 55–95 | rear 62–99, front 53–81.5 | fits normal running |
| Inter surface | 30–85 | rear 37.6–80.5, front 33–63.4 | fits |
| Wet carcass | 45–65 | rear 55–77, front 51–63 (1 Hz, thin) | rears exceed it |
| Wet surface | 50–80 (estimate) | rear 32–50, front 28–43 (1 Hz, thin) | above nearly all values |
| Pressure | setup −1.5 / +1.0 psi | slick rear −0.62…+0.88, front −1.37…+0.49; inter rear p95 +2.44 | right reference, fixed psi is the wrong scale |

**Proposal A: carcass bands per actual compound, Tref −20 … +15 °C.**

| C1 | C2 | C3 | C4 | C5 | inter | wet |
|---|---|---|---|---|---|---|
| 85–120 | 75–110 | 70–105 | 65–100 | 60–95 | 45–80 | 35–70 |

- C3 keeps today's slick band; the user's 70–105 °C came from a driver on C3-like running, which fits.
- The −20 / +15 margins are a judgement from the measured spread and the inter wear slope, not a game figure. The asymmetry follows real F1 too: above the window wear "can become critical" ([Pirelli 2017](https://www.pirelli.com/global/en-ww/race/seeing-through-the-window)).
- Option: an axle offset (fronts 5–10 °C colder in normal running); without it the fronts sit near the bottom.
- Inter 45–80 is tighter at the top than today's 95: on inters wear at Tref + 15…25 is about double that near Tref. Whether that is "out of band" or "a wear warning" is the user's call.

**Proposal B: the pressure band derived from the carcass band.** lo = setup × (Tref − 20 + 273.15) / (Tref + 273.15), hi = setup × (Tref + 15 + 273.15) / (Tref + 273.15): about −5.5 % / +4 % of setup. At setup 23.5 on inters −1.4 / +1.0 psi; 20.5 on C3 −1.1 / +0.8; 26.5 on C3 −1.5 / +1.1. The band then agrees with the carcass band by construction; it adds a reading in psi, not a second judgement. A fixed psi offset judges a different carcass range per setup (−24…+16 °C at 23.5 inters, −20…+14 °C at 26.5 slicks).

**Proposal C: surface.** Slick keep 55–100 or tighten to 65–100; inter keep 30–85; **wet lower to about 30–55** (thin: 2 recordings, Mexico and Miami).

**Proposal D: which cars.** Judge temperature and pressure bands only on cars whose tyres the game simulates: our human-driven cars (car driver, C17) and other humans' temperatures. AI cars' bands measure nothing (§6); the advisories on the AI teammate (car 7, lap 14, live checklist) were noise. For other humans online, pressure is a constant and its band says nothing either.

### 7.2 Wear prediction inputs

Today wear is a rate per lap from the stint (research 12 §3: age and wear are the same variable within a dry stint). Two inputs the recordings support:
- **Carcass above Tref, on inters:** about +0.04 %/lap per °C. A human stint whose carcass climbs (drying track, pushing) wears faster than its first laps say. On slicks the effect is not measurable; do not add it there yet.
- **The track's wetness trend:** on the Silverstone drying track the AI inters, with flat temperatures, wore ×1.4 more in the second half. The field's lap-time trend per tyre type is the only signal (no wetness field); the forecast's rain % is not (§7.3).

An age-only rate underestimated Silverstone's last 8 laps by about ×2. Both inputs are judgements over values and the projection, so they belong to a calculator that the strategy, pit-window and crossover units read alike (C43). The game's TyreSets `m_lifeSpan` and `m_lapDeltaTime` are untested as an input and zeroed for restricted cars.

### 7.3 The Silverstone 2026-11-14 case

Car 19 (DR), inters from lap 34, drying track, forecast light rain 76–78 % to the flag, track 29 → 28 °C (`2026-11-14_00-04-26_b8b0b47d214aa738_car19`, `spike/wear.py`):

| Laps | RL wear rate | RL inner (Tref 65) | RL psi (setup 23.5) | Lap time | AI inters RL rate |
|---|---|---|---|---|---|
| 38–44 | 1.86 %/lap (1–2) | 75–88 °C | 24.2–25.1 | 104.9 → 102.6 s | 1.22 %/lap |
| 45–51 | 3.71 %/lap (3–4) | 93–105 °C | 25.4–26.3 | 101.9–103.7 s | 1.67 %/lap |

- RL wear 9 % → 50 % at the flag. The field's AI median lap 106.8 s (lap 37) → 102.0 s (lap 51), 17 cars.
- **Drying, alone:** ×1.4 on the AI. **Car 19:** ×2.0, its excess over the AI from 1.5 × (normal for a human) to 2.2 ×. The extra ~45 % is about what the inter slope (+0.042 per °C) gives for 15–20 °C more overheat.
- **Setup pressure:** the rear 23.5 psi is lower than DR's 26.5 at Singapore and Zandvoort; the front 29.5 is the highest seen. In the game the setup only sets which pressure the tyre shows at Tref. The data show a carcass far above Tref on a drying track, and the pressure rose with it: a symptom, not a cause the data can isolate. Whether a lower setup would have heated the tyre less is not measurable from our recordings. The user's "both" stays possible; the recording supports "the drying track, and a carcass that overheated on it".
- **Bands as built would have flagged it:** the RL pressure crossed setup + 1.0 on lap 43 (24.8 psi, inner 83 °C = Tref + 18), the inter carcass top (95 °C) on lap 46. Proposal A's 80 °C top would have flagged it by lap 43 at the latest (inner 83 °C). The wear rate doubled from lap 45.
- **The crossover:** lap times went under 110 % of the 94.3 s dry reference from about lap 43 while the forecast still said rain. Lap times beat the forecast as a drying signal, as research 12 found at Singapore. What `crossover.car` and `track-wetness` said on the recording is still to be checked (live checklist).
- **Profiles and calibration:** this stint's 2.87 %/lap (2.1 × the AI) is an outlier for DR's `driverNoise.wearRatePct.inter` and a Silverstone set's inter wear; the recording agrees with the checklist's idea to exclude it. A stint with its carcass mostly within Tref ± 10 would be the normal case.

### 7.4 Setup-pressure check

- Our cars' setup pressures are known before the race (Setups packet; own car only online). The check can read the newest setup, never the first sample (it can be the default).
- **What the check cannot say from data:** "too high for the compound". The game makes any setup reach its own value at Tref.
- **What it can say:** the setup against the driver's own usual (rear 20.5–26.5, front 24.2–29.5 seen), against the track default (the AI value), and after a few laps, the running pressure against setup, which is the carcass against Tref. Real F1 gives a direction but no game number: higher pressure means a smaller patch, more sliding and more surface heat (§3), and the one F1 25 anecdote says the opposite for wear (§5).
- A check worth having before the race is a reminder with numbers, not a verdict; a verdict needs the controlled test in §8.

### 7.5 AI tyre values carry no information

- AI carcass = Tref, AI slick surface = one value per compound, AI pressure = the track's default setup. They say which compound the car is on, and nothing else.
- Units that judge a rival's tyre state read wear (AI wear responds to compound, track and drying) and lap times, not temperatures or pressures.
- For other humans online, temperatures are real, pressure is a placeholder, and wear is zeroed if their telemetry is restricted (`m_yourTelemetry`; a zero wear looks like a new tyre).

## 8. Open gaps and recordings wanted

**Gaps:**
- Setup pressure's own effect on heating and wear in the game: never varied within a session.
- Slick wear against overheat: no within-stint relation; 12 stints across sessions.
- Track temperature: within a stint 1–2 °C steps; across sessions confounded with track and setup.
- Inter and wet windows in F1 25 rest on 4 and 2 human recordings; C2 and C5 on 2 and 3 files.
- Blisters: never seen. Whether they need a setting or conditions we have not met is unknown.
- `m_tyreTemperature` = 0 (surface only): no recording.
- The game's setup slider limits: only observed values.
- Real F1: no 18-inch windows, no degradation per °C of track or per psi, no drying rate.

**Recordings wanted:**
- **One practice, same track, same compound, two pressure setups** (e.g. rear 20.5 and 26.5), 8+ laps each, same driver: the only way to measure setup pressure against carcass heat and wear.
- **A long dry stint on C1 or C2 and one on C4 or C5** by one of our drivers: the per-compound bands' ends.
- **A drying race with a human on inters and a stop to slicks**, and one where a human stays out: the crossover and inter wear against wetness.
- **A full wet stint by a human** (wets): the wet surface and carcass bands.
- **A hot and a cool session at one track** (day and night, or two weekends): track temperature against wear.
- **An online session with a restricted human rival**: whether blisters and temperatures stay visible.
- **A session with blisters showing on our tyres in game**: whether `tyreBlisters` ever moves.
