# Calibration values: everything pitwall can be calibrated with

Status 2026-11-14 (main `514d915f`). Three places hold values a run computes with; each has its own owner and its own way in.

| Where | Per | Who fills it | Takes effect |
|---|---|---|---|
| Calibration set (`PITWALL_DATA_DIR/calibration/<trackId>/`) | track | you, in the calibration panel: stints of stored sessions as sources, or an override per key | an edit of the running set at once (a decision); otherwise the next session start |
| Track file (`data/tracks/<trackId>.json`) | track | `pitwall-trackdata` (OpenF1, MultiViewer, Kaggle), copied in by the supervisor | next session start |
| Driver profile (`PITWALL_DATA_DIR/drivers/`) | person | you, in the drivers panel: link a person to a seat (team + race number); entries come from their stored sessions | next session start |

Lookup order for a value: the calibration set's entry (override, else fitted from its sources), else the track file's default, else the unit's config default, else `unknown`.

## 1. Calibration set: 44 keys per track

24 tracks × 44 keys = 1,056 values in all. Most fill themselves from sources; only override what you know better.

### Pit loss (3 keys): the most important

| Key | Fitted from | Without it |
|---|---|---|
| `pitLoss.ms.green` | the sources' green-flag stops: in-lap + out-lap − 2 × the racing laps before | track file `pitLossMs.green` |
| `pitLoss.ms.vsc` | stops under a VSC | track file `pitLossMs.vsc` |
| `pitLoss.ms.sc` | stops under a SC | track file `pitLossMs.sc` |

Needs: race stints that include a stop. Missing it blocks strategy, undercut, SC call and pit sweep (Silverstone 2026-11-13).

### Tyre pace and degradation (15 keys: 3 × 5 compounds)

Compounds: `soft`, `medium`, `hard`, `inter`, `wet`.

| Key | Meaning | Without it |
|---|---|---|
| `degradation.alphaOffsetMs.<compound>` | the compound's pace offset to the medium (ms) | track file `compoundOffsetsMs` (soft, medium, hard only); inter and wet have none |
| `degradation.nuMsPerLap.<compound>` | time lost per lap of tyre age (ms/lap) | config 150 ms/lap |
| `degradation.nuSdMs.<compound>` | the spread of that rate (ms) | config 100 ms |

Needs: stints of at least 2 pace laps on that compound.

### Tyre wear (20 keys + 2 limits)

| Key | Meaning | Without it |
|---|---|---|
| `tyreLife.wearPerLapPct.<compound>.<fl\|fr\|rl\|rr>` | wear % per lap per corner (20 keys) | none: measured live after 3 laps of the stint |
| `tyreLife.wearLimitPct` | override only: wear at which a set is done | config 70 % |
| `tyreLife.ageLossLimitMs` | override only: lost time at which a set is done (age basis) | config 2,000 ms |

### Overtaking (4 keys)

| Key | Meaning | Without it |
|---|---|---|
| `raceInteraction.passLevel.b0`, `.passSlope.b0` | pass curve for AI difficulty 0–79 | pooled fit over 5 F1 25 races (config) |
| `raceInteraction.passLevel.b1`, `.passSlope.b1` | pass curve for AI difficulty 80–110 | the same |

Needs: race stints where the car follows another (episodes).

## 2. Track file defaults (per track, outside pitwall)

| Default | Feeds | Missing on |
|---|---|---|
| `pitLossMs.green/vsc/sc` | pit loss without a set | **Australia (0), Great Britain (7), Miami (30)** |
| `pitLossInLapShare` | how the loss splits between in-lap and out-lap (else config) | **Australia, Great Britain, Miami** |
| `compoundOffsetsMs` | soft / hard pace vs the medium | **Australia, China, Canada, Belgium, Azerbaijan, Emilia Romagna, Saudi Arabia, Miami, Las Vegas** |
| `hazard` | SC and VSC chance per lap and their length | none missing |

Suspicious: Great Britain `compoundOffsetsMs.hard` = +6,956 ms (from a wet race; a dry hard is typically under 1 s slower).

Not in any track file: inter and wet pace offsets, and anything about rain.

## 3. Driver profiles (per person, not per track)

| Key | Meaning | Without it (human default) |
|---|---|---|
| `driverNoise.sigmaMs` | lap-to-lap scatter | 450 ms |
| `driverNoise.rho` | how much one lap's error carries into the next | 0.3 |
| `driverNoise.mistakeRate` | mistakes per lap | 0.06 |
| `driverNoise.mistakeMedianMs` | typical mistake size | 1,200 ms |
| `driverNoise.mistakeSigmaLog` | mistake size spread | config |
| `driverNoise.wearRatePct.<compound>` | the driver's tyre wear (5 keys) | 2.0 %/lap |

AI cars use the AI field's values (σ 200 ms, 0.024 mistakes per lap, 700 ms median).

## 4. Weather

Nothing is calibrated. The forecast comes from the game. The slick-to-inter crossover uses a fixed line (110 % of the dry reference lap). Inter and wet pace come only from laps seen in the session.

## What to do first

1. **Pit loss for Australia, Great Britain and Miami**: in the track-data generator (fall back to a dry year), or a set with `pitLoss.ms.*` overrides.
2. **One calibration set per track you race**, sourced from your own full races: pit loss, degradation and wear fill themselves. Start pitwall before the session so the whole race is recorded.
3. **Link each friend in the drivers panel** once: profiles fill from their sessions.
4. **Missing compound offsets** (9 tracks) and inter/wet offsets: from the sets' sources once you have them, else an override.
