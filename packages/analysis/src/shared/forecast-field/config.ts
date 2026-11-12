// Defaults of `forecast-field` (SP4.3a spec 6.1, 6.2, 8): the "as of" placement, the stand-ins of the starting point and
// the lap model's parameters it builds (plan review P9).
import { defineConfig } from '@pitwall/engine/readers';

export const FORECAST_FIELD_CONFIG = defineConfig('forecast-field', {
  /** The "as of" build's lap fraction and gap may differ from the live build's by less than this (ms). Source: pitwall estimate (spec 6.1). */
  placementToleranceMs: 1500,
  /** The pace σ of a car whose stint has no posterior yet (fewer than two pace laps), in ms. Source: pitwall estimate. */
  fallbackPaceSdMs: 500,
  /** The least wear rate a car's degradation per % wear is divided by, in % per lap (bounds `ν / rate`). Source: pitwall estimate. */
  minWearRatePctPerLap: 0.05,
  /** The sd of the track file's compound offsets as the fit's prior, in ms: a weak prior (spec 6.2). Source: pitwall estimate. */
  compoundOffsetPriorSdMs: 500,
  /** The soft's fresh-set offset against medium without a track file's, in ms. Source: research 13 §1 (assumed). */
  defaultSoftOffsetMs: -600,
  /** The hard's fresh-set offset against medium without a track file's, in ms. Source: research 13 §1 (assumed). */
  defaultHardOffsetMs: 500,
  /** The inter's offset against medium on a dry track, in ms (the wetness term adds the rest). Source: spike 4.3b-defaults (research 19 §4): Singapore's slick/inter crossover at 6–8 s inter excess, with interMsPerWetnessMs 0.5; one crossover, thin; the three wet values hold together */
  interOffsetMs: 3500,
  /** The wet's offset against medium on a dry track, in ms. Source: spike 4.3b-defaults (research 19 §4): Miami's wet/inter meeting at 12.5 s inter excess, with interOffsetMs 3500 and interMsPerWetnessMs 0.5; one race, thin */
  wetOffsetMs: 8100,
  /** The convex tyre term starts at this wear, in %. Source: research 12 §4, 13 §1 (Fieni's shape, flagged). */
  convexFromPct: 40,
  /** The convex tyre term per (% wear past `convexFromPct`)², in ms: about 4 s at 80 %. Source: pitwall estimate (flagged prior); spike 4.3b-defaults (research 19 §3): wet stints bracket 1.7–5.4 (25 stints past 40 %, Mexico and Miami), dry not identified (max 50 %): kept */
  convexMsPerPct2: 2.5,
  /** The cold-tyre term of the first lap on a set, in ms. Source: research 12 §3 (Texas, +0.41 s dry). */
  coldTyreLap1Ms: 410,
  /** The cold-tyre term of the second lap on a set, in ms. Source: spike 4.3b-defaults (research 19 §5): lap 2 on a new set −170 ± 156 ms (all green, 40), −475 ± 261 (free air, 10) without the term, after the ν prior change; a fresh-set peak not identified; thin. */
  coldTyreLap2Ms: 0,
  /** The cold-tyre terms on a wet track are this times the dry ones. Source: research 12 §3 (Mexico inters +1.4 s, thin). */
  coldTyreWetFactor: 3.4,
  /** A lap behind the SC is this times the green lap. Source: spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs in 4 races, ±0.02 */
  scPaceFactor: 1.27,
  /** Tyre wear behind the SC is this times the green lap's. Source: spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs, ±0.03 */
  scWearFactor: 0.36,
  /** Fuel burn behind the SC is this times the green lap's. Source: spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs, ±0.01 */
  scFuelFactor: 0.57,
  /** A VSC lap is this times the green lap. Source: spike 4.3b-defaults (research 19 §2): 70 partial VSC laps, 3 VSCs, Mexico and Miami (wet only), ±0.01; thin */
  vscPaceFactor: 1.19,
  /** Tyre wear under the VSC is this times the green lap's. Source: spike 4.3b-defaults (research 19 §2): VSC 0.24 ± 0.17 (thin, 3 VSCs), set to the SC's 0.36 */
  vscWearFactor: 0.35,
  /** Fuel burn under the VSC is this times the green lap's. Source: spike 4.3b-defaults (research 19 §2): 0.62 ± 0.03, 3 VSCs; thin: kept */
  vscFuelFactor: 0.6,
  /** A slick's loss per ms of track wetness (the wetness is the slick's loss, so 1). Source: spec 5.1 (definition). */
  slickMsPerWetnessMs: 1,
  /** An inter's loss per ms of track wetness. Source: pitwall estimate; not identifiable from the recordings (research 19 §4) */
  interMsPerWetnessMs: 0.5,
  /** A wet's loss per ms of track wetness. Source: spike 4.3b-defaults (research 19 §4): Miami sWet/sInter 0.49 ± 0.12 (14 laps) × interMsPerWetnessMs 0.5; one race, thin */
  wetMsPerWetnessMs: 0.25,
  /** The sd of the wetness prior (a dry track) while track-wetness has no known state, in ms. Source: pitwall estimate (ruling R40). */
  priorWetnessSdMs: 1500,
  /** Whether a rival whose owesStop is unknown is assumed to owe a stop. Source: pitwall estimate (ruling R40: the dry race's compound rule). */
  assumeOwesStop: true as boolean,
  /**
   * The compound a car's newest lap stands in with when its visual compound is unknown (a noise compound: soft, medium,
   * hard, inter, wet; another value gives this default). Source: pitwall estimate (the reference compound, the lap
   * model's zero offset; final review F4).
   */
  unknownCompound: 'medium' as string,
  /**
   * A competing car without a completed lap (still on lap 1) takes the leader's newest lap as its stand-in, its lap time
   * plus this (ms). Source: pitwall estimate (a car on lap 1 runs at about the leader's pace; final review F4).
   */
  noLapStandInOffsetMs: 0,
  /** The part of a stop's loss paid on the in-lap, the rest on the out-lap: 0.26 = 5.5 s of F1 25's 21.5 s green stop. Source: research 12 §5. */
  inLapLossShare: 0.26,
  /** Whether a car whose driver is unknown (no car-driver span yet) is modelled as a human. Source: pitwall estimate (the AI, the field's majority; final review F4). */
  unknownDriverIsHuman: false as boolean,
});
