# Calibration values: everything pitwall can be calibrated with

Status 2026-11-16 (`sp4.3c/integ`). Three places hold values a run computes with; each has its own owner and its own way in.

| Where | Per | Who fills it | Takes effect |
|---|---|---|---|
| Calibration set (`PITWALL_DATA_DIR/calibration/<trackId>/`) | track | you, in the calibration panel: stints of stored sessions as sources, or an override per key | an edit of the running set at once (a decision); otherwise the next session start |
| Track file (`data/tracks/<trackId>.json`) | track | `pitwall-trackdata` (OpenF1, MultiViewer, Kaggle), copied in by the supervisor | next session start |
| Driver profile (`PITWALL_DATA_DIR/drivers/`) | person | you, in the drivers panel: link a person to a seat (team + race number); entries come from their stored sessions | next session start |

Lookup order for a value: the calibration set's entry (override, else fitted from its sources), else the track file's default, else the unit's config default, else `unknown`.

## 1. Calibration set: 23 keys per track

24 tracks × 23 keys = 552 values in all. Most fill themselves from sources; only override what you know better.

### Pit loss (3 keys): the most important

| Key | Fitted from | Without it |
|---|---|---|
| `pitLoss.ms.green` | the sources' green-flag stops: in-lap + out-lap − 2 × the racing laps before | track file `pitLossMs.green` |
| `pitLoss.ms.vsc` | stops under a VSC | track file `pitLossMs.vsc` |
| `pitLoss.ms.sc` | stops under a SC | track file `pitLossMs.sc` |

Needs: race stints that include a stop. Every track file now has a pit-loss default (dry-year fallback for Australia, Great Britain and Miami, SP4.3c Task 11).

### Tyre pace and degradation (15 keys: 3 × 5 compounds)

Compounds: `soft`, `medium`, `hard`, `inter`, `wet`.

| Key | Meaning | Without it |
|---|---|---|
| `degradation.alphaOffsetMs.<compound>` | the compound's pace offset to the medium (ms) | track file `compoundOffsetsMs` (soft, medium, hard only); inter and wet have none (the lap model's config: inter +3,500 ms, wet +8,100 ms) |
| `degradation.nuMsPerLap.<compound>` | time lost per lap of tyre age (ms/lap) | config 150 ms/lap |
| `degradation.nuSdMs.<compound>` | the spread of that rate (ms) | config 100 ms |

Needs: stints of at least 5 pace laps on that compound (to be suggested as a source; 2 to be fitted).

### Dry reference (1 key)

| Key | Meaning | Without it |
|---|---|---|
| `trackWetness.dryRefMs` | the dry medium-scale reference lap (ms), the median over the set's dry slick stints | the weekend's earlier sessions' field reference, else the session's own slick laps |

Needs: dry slick stints.

### Tyre wear: not calibrated (removed in SP4.3c)

The per-corner wear keys `tyreLife.wearPerLapPct.*` and the limits `tyreLife.wearLimitPct`, `tyreLife.ageLossLimitMs` are gone. Wear is the game's rate (70 % over the set's usable life) times a driver's wear factor (section 3), measured live after 3 rate laps of the stint. The one limit is the config key `tyre-model.limitPct` (70 %), changed only in `config.json`.

### Overtaking (4 keys)

| Key | Meaning | Without it |
|---|---|---|
| `raceInteraction.passLevel.b0`, `.passSlope.b0` | pass curve for AI difficulty 0–79 | pooled fit over 5 F1 25 races (config) |
| `raceInteraction.passLevel.b1`, `.passSlope.b1` | pass curve for AI difficulty 80–110 | the same |

Needs: race stints where the car follows another (at least 3 episodes to be suggested as a source).

## 2. Track file defaults (per track, outside pitwall)

| Default | Feeds | Missing on |
|---|---|---|
| `pitLossMs.green/vsc/sc` | pit loss without a set | none missing |
| `pitLossInLapShare` | how the loss splits between in-lap and out-lap (else config) | none missing |
| `compoundOffsetsMs` | soft / hard pace vs the medium, and the `α` start of `degradation` | **China, Canada, Belgium, Azerbaijan, Emilia Romagna, Saudi Arabia, Las Vegas** |
| `hazard` | SC and VSC chance per lap and their length | none missing |

Great Britain's hard offset is now +382 ms (the dry-year fallback replaced the wet race's +6,956 ms).

Not in any track file: inter and wet pace offsets, and anything about rain.

## 3. Driver profiles (per person, not per track)

| Key | Meaning | Without it (human default) |
|---|---|---|
| `driverNoise.sigmaMs` | lap-to-lap scatter | 450 ms |
| `driverNoise.rho` | how much one lap's error carries into the next | 0.3 |
| `driverNoise.mistakeRate` | mistakes per lap | 0.06 |
| `driverNoise.mistakeMedianMs` | typical mistake size | 1,200 ms |
| `driverNoise.mistakeSigmaLog` | mistake size spread | 0.8 |
| `tyreModel.wearFactor.<compound>` | the driver's wear factor k against the game's rate 70 % / usable life (5 keys: soft, medium, hard, inter, wet; replaces `driverNoise.wearRatePct.*`) | 1.3 |

10 keys per person. AI cars use the AI field's values (σ 200 ms, 0.024 mistakes per lap, 700 ms median, wear factor 0.86).

## 4. Weather

Only the dry reference is calibrated (`trackWetness.dryRefMs`, section 1). The forecast comes from the game. The slick-to-inter crossover uses a fixed line (110 % of the dry reference lap, `crossover.line110`). Inter and wet pace start from the config offsets (+3,500 ms, +8,100 ms vs the medium) and follow the laps seen in the session.

## What to do first

1. **One calibration set per track you race**, sourced from your own full races: pit loss, degradation, dry reference and pass curves fill themselves. Start pitwall before the session so the whole race is recorded.
2. **Link each friend in the drivers panel** once: profiles (noise and wear factor) fill from their sessions.
3. **Missing compound offsets** (7 tracks) and inter/wet offsets: from the sets' sources once you have them, else an override.
