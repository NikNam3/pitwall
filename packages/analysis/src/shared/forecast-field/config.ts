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
  /** The inter's offset against medium on a dry track, in ms (the wetness term adds the rest). Source: pitwall estimate. */
  interOffsetMs: 5000,
  /** The wet's offset against medium on a dry track, in ms. Source: pitwall estimate. */
  wetOffsetMs: 9000,
  /** The convex tyre term starts at this wear, in %. Source: research 12 §4, 13 §1 (Fieni's shape, flagged). */
  convexFromPct: 40,
  /** The convex tyre term per (% wear past `convexFromPct`)², in ms: about 4 s at 80 %. Source: pitwall estimate (flagged prior). */
  convexMsPerPct2: 2.5,
  /** The cold-tyre term of the first lap on a set, in ms. Source: research 12 §3 (Texas, +0.41 s dry). */
  coldTyreLap1Ms: 410,
  /** The cold-tyre term of the second lap on a set, in ms: a quarter of the first. Source: research 12 §3. */
  coldTyreLap2Ms: 100,
  /** The cold-tyre terms on a wet track are this times the dry ones. Source: research 12 §3 (Mexico inters +1.4 s, thin). */
  coldTyreWetFactor: 3.4,
  /** A lap behind the SC is this times the green lap. Source: research 03 (TUM, ×1.6). */
  scPaceFactor: 1.6,
  /** Tyre wear behind the SC is this times the green lap's. Source: pitwall estimate. */
  scWearFactor: 0.5,
  /** Fuel burn behind the SC is this times the green lap's. Source: pitwall estimate. */
  scFuelFactor: 0.5,
  /** A VSC lap is this times the green lap. Source: research 03 (TUM, ×1.4). */
  vscPaceFactor: 1.4,
  /** Tyre wear under the VSC is this times the green lap's. Source: pitwall estimate. */
  vscWearFactor: 0.6,
  /** Fuel burn under the VSC is this times the green lap's. Source: pitwall estimate. */
  vscFuelFactor: 0.6,
  /** A slick's loss per ms of track wetness (the wetness is the slick's loss, so 1). Source: spec 5.1 (definition). */
  slickMsPerWetnessMs: 1,
  /** An inter's loss per ms of track wetness. Source: pitwall estimate. */
  interMsPerWetnessMs: 0.5,
  /** A wet's loss per ms of track wetness. Source: pitwall estimate. */
  wetMsPerWetnessMs: 0.35,
  /** The sd of the wetness prior (a dry track) while track-wetness has no known state, in ms. Source: pitwall estimate (ruling R40). */
  priorWetnessSdMs: 1500,
  /** Whether a rival whose owesStop is unknown is assumed to owe a stop. Source: pitwall estimate (ruling R40: the dry race's compound rule). */
  assumeOwesStop: true as boolean,
});
