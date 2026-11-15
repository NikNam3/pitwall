// `tyre-model`'s driver-profile entries (SP4.3c spec §5.2, C62c): per compound a human's wear factor k, the person's
// measured rate against the game's 70 / usableLife (research 21 §13, 22 §1.3: scale-free across race distances). Per
// linked session and stint on the compound, over the linked car's laps in its human car-driver spans: the worst corner's
// cumulative rate over the stint's rate laps (the unit's measured-rate thresholds) over the game's rate of the stint's
// fitted set; the sessions' stints weighted by their rate laps.
import { carDriverSpans, currentLaps, known, NOISE_COMPOUNDS, unknown, type Known, type LapRecord, type NoiseCompound } from '@pitwall/domain';
import { defineProfiles, membershipOf, type ProfileCtx, type ProfileEntryDecl, type StoredDriverSession } from '@pitwall/engine/readers';
import { isRateLap, LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { configOf } from '../shared/config-of.ts';
import { gamePriorRatePct } from '../shared/tyre-prior.ts';
import { TYRE_MODEL_CONFIG } from './config.ts';
import { wearFactorKey } from './model.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/**
 * The linked car's human laps (those whose described frame the projection module's membership puts in one of the car's
 * `human` car-driver spans, C26), one record per lap, cut into stints on one set (a compound change or a set younger
 * than the lap before).
 */
function humanStints(session: StoredDriverSession): LapRecord[][] {
  const source = { history: session.projection };
  const laps = currentLaps(session.projection.laps as readonly LapRecord[]).filter((l) => l.carId === session.carId && membershipOf(source, l)[carDriverSpans.machine]?.kind === 'human');
  const stints: LapRecord[][] = [];
  let run: LapRecord[] = [];
  for (const l of laps) {
    const prev = run.at(-1);
    if (prev !== undefined && (prev.visualCompound !== l.visualCompound || l.tyreAgeAtStart <= prev.tyreAgeAtStart)) {
      stints.push(run);
      run = [];
    }
    run.push(l);
  }
  if (run.length > 0) stints.push(run);
  return stints;
}

/** The usable life of a stint's fitted set as the game gave it on one of its laps. */
function usableLifeOf(stint: readonly LapRecord[]): number | undefined {
  for (const l of stint) {
    if (!l.tyreSets.known) continue;
    const life = l.tyreSets.value.find((s) => s.fitted)?.usableLifeLaps;
    if (life !== undefined && life > 0) return life;
  }
  return undefined;
}

/** A stint's k and the rate laps it rests on: its worst corner's cumulative rate over the game's rate (k = 1), if measured. */
function stintFactor(stint: readonly LapRecord[], ctx: ProfileCtx): { k: number; laps: number; at: number } | undefined {
  const c = configOf(TYRE_MODEL_CONFIG, ctx);
  const { maxNeutralisedMs } = configOf(LAP_CLASSES_CONFIG, ctx);
  const life = usableLifeOf(stint);
  if (life === undefined) return undefined;
  let worst: { rate: number; laps: number } | undefined;
  for (const corner of CORNERS) {
    let sum = 0;
    let n = 0;
    for (const l of stint) {
      const start = l.wearAtStartPct[corner];
      const end = l.wearAtEndPct[corner];
      if (!start.known || !end.known || !isRateLap(l, { maxNeutralisedMs })) continue;
      sum += end.value - start.value;
      n++;
    }
    if (n < c.minGainLaps || sum < c.minAccruedPct) continue;
    if (worst === undefined || sum / n > worst.rate) worst = { rate: sum / n, laps: n };
  }
  if (worst === undefined) return undefined;
  return { k: worst.rate / gamePriorRatePct(life, 1, c.limitPct), laps: worst.laps, at: (stint.at(-1) as LapRecord).completedAt };
}

/** The k of `compound`: the laps-weighted mean over the sessions' stints on it (C3: `insufficientData` without one). */
const factorEntry = (compound: NoiseCompound): ProfileEntryDecl => ({
  version: 1,
  range: [0.2, 3],
  aggregate(sessions, ctx): { value: Known<number>; laps: number } {
    let sum = 0;
    let laps = 0;
    let at = 0;
    for (const session of sessions) {
      for (const stint of humanStints(session)) {
        if (stint[0]?.visualCompound !== compound) continue;
        const f = stintFactor(stint, ctx);
        if (f === undefined) continue;
        sum += f.k * f.laps;
        laps += f.laps;
        at = Math.max(at, f.at);
      }
    }
    return laps === 0 ? { value: unknown('insufficientData'), laps: 0 } : { value: known(sum / laps, at), laps };
  },
});

export const TYRE_MODEL_PROFILES = defineProfiles('tyre-model', {
  entries: Object.fromEntries(NOISE_COMPOUNDS.map((c) => [wearFactorKey(c), factorEntry(c)])),
});
