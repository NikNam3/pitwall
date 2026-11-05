// Battle's behaviour table (contract C44): what battle computes for each kind of the sub-machines it reads.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the weekend phase allows: battle cards are computed in a race only. */
export type PhaseBehaviour = { cards: 'computed' | 'notApplicable' };
/** What race control allows: `enabled` DRS, or `disabled` with the reason of the span's detail. */
export type DrsBehaviour = { drs: 'enabled' | 'disabled' };
/**
 * What a span does to the mini-sectors of PACE Δ's window it shares a frame with (C26): they `count`, or they are
 * `skipped`: the car off the track (a car's span), or a neutralisation (a session-phase span, as `shared/neutralised.ts`
 * counts it).
 */
export type SegmentBehaviour = { segment: 'counts' | 'skipped' };
export type BattleBehaviour = PhaseBehaviour | DrsBehaviour | SegmentBehaviour;

const COUNTS = { segment: 'counts' } as const;
const SKIPPED = { segment: 'skipped' } as const;

/** One row per kind of every sub-machine battle reads (C44). `weekend-phase` `none` is `notApplicable` (C14). */
export const BATTLE_BEHAVIOUR = {
  'weekend-phase': {
    race: { cards: 'computed' },
    practice: { cards: 'notApplicable' },
    qualifying: { cards: 'notApplicable' },
    none: { cards: 'notApplicable' },
  },
  'race-control-race': {
    drsOn: { drs: 'enabled' },
    drsOff: { drs: 'disabled' },
  },
  'car-location': { track: COUNTS, pitLane: SKIPPED, garage: SKIPPED },
  'session-phase-race': {
    grid: COUNTS,
    formation: COUNTS,
    startLights: COUNTS,
    racing: COUNTS,
    neutralised: SKIPPED,
    suspended: SKIPPED,
    finished: COUNTS,
    postSession: COUNTS,
  },
  'session-phase-qualifying': { grid: COUNTS, running: COUNTS, suspended: SKIPPED, finished: COUNTS, postSession: COUNTS },
  'session-phase-practice': { grid: COUNTS, running: COUNTS, suspended: SKIPPED, finished: COUNTS, postSession: COUNTS },
} as const satisfies BehaviourTable<BattleBehaviour>;

/** The machines whose spans can skip a mini-sector of the window: car location and the session phases. */
export type SegmentMachine = 'car-location' | 'session-phase-race' | 'session-phase-qualifying' | 'session-phase-practice';

/** Whether a span of `machine` of kind `kind` skips the mini-sectors it shares a frame with; a kind without a row is a bug (C3). */
export function skipsSegments(machine: SegmentMachine, kind: string): boolean {
  const table: Readonly<Record<string, SegmentBehaviour>> = BATTLE_BEHAVIOUR[machine];
  const row = Object.hasOwn(table, kind) ? table[kind] : undefined;
  if (row === undefined) throw new Error(`battle behaviour: no row for ${machine} ${kind}`);
  return row.segment === 'skipped';
}
