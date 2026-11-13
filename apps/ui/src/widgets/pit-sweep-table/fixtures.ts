// Builders and cases shared by the pit-sweep-table gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/pit-sweep-table.html, gen.mjs `SWEEP`, `SW_S`): Spa,
// 44 laps, L14, KUH P8 on mediums since L1 (their life ends L22). One row per stop lap L14 … L26; each row's place
// distribution is gen.mjs' `placeDist`, its E[pos] and P(gain) computed from it as gen.mjs does; `inWindow` (within the
// tie test of the best) and `pastLife` written as `pit-sweep` fills them. The display computes none of it (C65).
import type { Computed } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { NoiseCompound, PitSweep, PitSweepRow, PitSweepTable } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);

export const PLACES = 20;
/** Our place now (gen.mjs `OUR_PLACE`) and the lap now (gen.mjs `NOW`). */
export const OUR_PLACE = 8;
export const NOW_LAP = 14;
export const KUH = carId(0);

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
/** gen.mjs `placeDist`: a skewed bell around mu plus a retirement share at P20. */
function placeDist(mu: number, sdL: number, sdR: number, dnf = 0.015): number[] {
  const w = Array.from({ length: PLACES }, (_, i) => {
    const d = i + 1 - mu;
    const s = d < 0 ? sdL : sdR;
    return Math.exp(-(d * d) / (2 * s * s));
  });
  const t = sum(w);
  return w.map((x, i) => (x / t) * (1 - dnf) + (i === PLACES - 1 ? dnf : 0));
}
const ePosOf = (p: number[]): number => sum(p.map((x, i) => x * (i + 1)));

/** gen.mjs `TIE`: the tie test's band for the sample. */
const TIE = 0.08;
/** The mediums' life ends at L22: a stop after it passes their life. */
const LIFE_END = 22;

const TRAFFIC: Record<number, number> = { 14: 1, 15: 2, 16: 3, 17: 3, 18: 1, 19: 0, 20: 0, 21: 1, 22: 1, 23: 0, 24: 0, 25: 1, 26: 0 };
const REJOIN: Record<number, number> = { 14: 13, 15: 13, 16: 14, 17: 14, 18: 13, 19: 12, 20: 12, 21: 12, 22: 11, 23: 11, 24: 11, 25: 10, 26: 10 };
const LAPS = Array.from({ length: 13 }, (_, i) => NOW_LAP + i);

/** gen.mjs `SWEEP` (onto H) and `SW_S` (onto S): each lap's mean place. */
const muHard = (lap: number): number => 7.42 + 0.018 * (lap - 20) ** 2 + 0.05 * (TRAFFIC[lap] ?? 0) + (lap > LIFE_END ? 0.12 * (lap - LIFE_END) : 0);
const muSoft = (lap: number): number => 7.6 + 0.02 * (lap - 18) ** 2 + 0.05 * (TRAFFIC[lap] ?? 0) + (lap > LIFE_END ? 0.12 * (lap - LIFE_END) : 0);

/** One compound's sweep as `pit-sweep` publishes it for KUH. */
export function sweepTable(compound: NoiseCompound, mu: (lap: number) => number, sdR: number): PitSweepTable {
  const drawn = LAPS.map((lap) => {
    const pmf = placeDist(mu(lap), 1.6, sdR);
    return { lap, pmf, ePos: ePosOf(pmf) };
  });
  const best = Math.min(...drawn.map((r) => r.ePos));
  const rows: PitSweepRow[] = drawn.map((r) => ({
    stopLap: r.lap,
    rejoinPosition: known(REJOIN[r.lap] ?? 0, at),
    traffic: known(TRAFFIC[r.lap] ?? 0, at),
    ePos: r.ePos,
    positionPmf: r.pmf,
    pGain: sum(r.pmf.slice(0, OUR_PLACE - 1)),
    meanMs: 4_980_000 + Math.round((r.ePos - best) * 4_000),
    pastLife: known(r.lap > LIFE_END, at),
    inWindow: r.ePos - best < TIE,
  }));
  return { compound, rows, scenarios: 1_000 };
}

/** The mockup's tables: auto → H (window L19–21), S set in the panel options (window L18–20). */
export const HARD = sweepTable('hard', muHard, 1.95);
export const SOFT = sweepTable('soft', muSoft, 2.0);

/** The job's result as `pitSweep.car` publishes it (C51). */
export const computed = (value: PitSweep): Computed<PitSweep> => ({ computedFor: { lap: NOW_LAP, frameId: 41_000 }, value });
export const sweep = (compound: PitSweep['compound'], fromAuto: boolean, table: PitSweep['table']): Computed<PitSweep> =>
  computed({ carId: KUH, lap: NOW_LAP, position: OUR_PLACE, compound, fromAuto, table });

/** The gallery's synthetic cases (data states only: the shell's option popover is window-local, P17). */
export const cases = {
  // The mockup's first figure (the screenshot baseline): auto resolves to H; the window L19–21 bold, L23–26 past life.
  autoHard: { sweep: sweep('hard', true, known(HARD, at)) },
  // The compound set to S in the panel options (`caseOptions`): the header cell S, hover "set".
  softSet: { sweep: sweep('soft', false, known(SOFT, at)) },
  // A compound we have no set of: that table notApplicable, the kit's mark with its reason (never the computing state).
  noSet: { sweep: sweep('wet', false, unknown('notApplicable')) },
  // auto unknown (it resolves to no NoiseCompound): the table carries auto's reason.
  autoUnknown: { sweep: sweep('auto', true, unknown('insufficientData')) },
  // The job before its first result: no value; the panel frame shows its computing state ("no data yet").
  computing: {},
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** Per case, the panel options over the declaration's defaults. */
export const caseOptions = {
  softSet: { compound: 'soft' },
  noSet: { compound: 'wet' },
} satisfies NonNullable<GalleryEntry<typeof widget>['caseOptions']>;

/** The gallery's fit sizes: the two minimums (compact 26×6, full 53×14) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 26, rows: 6 },
  { mode: 'compact', cols: 40, rows: 9 },
  { mode: 'full', cols: 53, rows: 14 },
  { mode: 'full', cols: 70, rows: 18 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
