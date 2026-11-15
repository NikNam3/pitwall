// `lap-classes` (spec 4): the one definition of which laps count. Functions, imported by the analyses that use it.
import type { LapRecord, WeekendPhase, weekendPhaseSpans } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

export * from './config.ts';

/**
 * Which uses a lap counts for. `forRate`: no in or out lap, neutralised time below `maxNeutralisedMs`. `forPace`: a
 * rate lap that is valid and not lap 1 of a race. `forBands`: a rate lap that is not lap 1 of a race; validity is not
 * required. `forBest`: per sector the sector is valid; the lap is valid.
 */
export type LapClass = { forPace: boolean; forRate: boolean; forBands: boolean; forBest: { lap: boolean; sectors: [boolean, boolean, boolean] } };

/** The session and the `lap-classes` config, as `classifyLap` needs them. */
export type LapClassOptions = { isRace: boolean; maxNeutralisedMs: number };

/** Time of the lap under SC or VSC, in ms. */
const neutralisedMs = (lap: DeepReadonly<LapRecord>): number => (lap.scShare + lap.vscShare) * lap.lapTimeMs;

/** Whether the lap's time under SC or VSC reaches `maxNeutralisedMs`: the one neutralised rule (C43). */
export function isNeutralisedLap(lap: DeepReadonly<LapRecord>, opts: Pick<LapClassOptions, 'maxNeutralisedMs'>): boolean {
  return neutralisedMs(lap) >= opts.maxNeutralisedMs;
}

/**
 * Whether any of the lap ran under an SC or VSC: a share above 0 on its record (SP4.3c O7, C43), for the readers that
 * mean "any SC" rather than the threshold rule (`isNeutralisedLap`). The lap record's shares decide (step 3 measured
 * them against the neutralisations of `shared/neutralised.ts`); the view is the reader's, for its declared reads.
 */
export function touchesNeutralisation(lap: DeepReadonly<Pick<LapRecord, 'scShare' | 'vscShare'>>, _view?: unknown): boolean {
  return lap.scShare > 0 || lap.vscShare > 0;
}

/** Which neutralisation a lap ran under: `sc` when it has any SC share, else `vsc` with a VSC share, else `null`. */
export function lapNeutralisationKind(lap: DeepReadonly<Pick<LapRecord, 'scShare' | 'vscShare'>>): 'sc' | 'vsc' | null {
  return lap.scShare > 0 ? 'sc' : lap.vscShare > 0 ? 'vsc' : null;
}

/** A weekend-phase kind with a span: every kind but `pending` (C14). */
export type LapPhaseKind = (typeof weekendPhaseSpans.kinds)[number];

/** A unit's weekend-phase row of the lap-1 rule: `isRace`, lap 1 of a race is no pace, band or reference lap. */
export type LapPhaseRow = { isRace: boolean };

/**
 * The one set of weekend-phase lap rows (C43, C44): only the race has the lap-1 rule. A unit spreads them into its
 * behaviour table's `weekend-phase` part and reads its row through `lapPhaseRowOf`.
 */
export const RACE_LAP_PHASE_ROWS = {
  practice: { isRace: false },
  qualifying: { isRace: false },
  race: { isRace: true },
  none: { isRace: false },
} as const satisfies Readonly<Record<LapPhaseKind, LapPhaseRow>>;

/**
 * A unit's weekend-phase row for `phase`: a pending phase has no span yet and reads as the race (C14: readers treat the
 * session as on the grid), so it gets the unit's race row.
 */
export function lapPhaseRowOf<T extends Readonly<Record<LapPhaseKind, unknown>>>(rows: T, phase: WeekendPhase['kind']): T[LapPhaseKind] {
  const kind: LapPhaseKind = phase === 'pending' ? 'race' : phase;
  return rows[kind];
}

/** Whether a lap counts for rates:`classifyLap(lap, opts).forRate`, without building the class. */
export function isRateLap(lap: DeepReadonly<LapRecord>, opts: Pick<LapClassOptions, 'maxNeutralisedMs'>): boolean {
  return !lap.inLap && !lap.outLap && !isNeutralisedLap(lap, opts);
}

/** Whether a rate lap (`forRate`) counts for bands: it is not lap 1 of a race. */
const bandsOf = (lap: DeepReadonly<LapRecord>, opts: LapClassOptions, forRate: boolean): boolean => forRate && !(opts.isRace && lap.lapNumber === 1);

/** Whether a lap counts for pace: `classifyLap(lap, opts).forPace`, without building the class. */
export function isPaceLap(lap: DeepReadonly<LapRecord>, opts: LapClassOptions): boolean {
  return bandsOf(lap, opts, isRateLap(lap, opts)) && lap.valid.lap;
}

/** Classifies one lap record. */
export function classifyLap(lap: DeepReadonly<LapRecord>, opts: LapClassOptions): LapClass {
  const forRate = isRateLap(lap, opts);
  const forBands = bandsOf(lap, opts, forRate);
  const forPace = forBands && lap.valid.lap;
  const s = lap.valid.sectors;
  return { forPace, forRate, forBands, forBest: { lap: lap.valid.lap, sectors: [s[0], s[1], s[2]] } };
}
