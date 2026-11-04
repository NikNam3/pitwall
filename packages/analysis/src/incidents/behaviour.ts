// The behaviour table of `incidents` (contract C14, C43, C44): what each kind of every sub-machine it reads gives the
// feed. The machine decides the situation; `incidents` only looks up the row of each span, open or closed. Penalties
// given are no row: they are the projection's penalty records (C25, C45).
import {
  carLocationSpans,
  carStatusSpans,
  sessionPhasePracticeSpans,
  sessionPhaseQualifyingSpans,
  sessionPhaseRaceSpans,
  warningsSpans,
  weekendPhaseSpans,
  type SpanDeclaration,
} from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a span of one kind gives the feed. */
export type IncidentsBehaviour =
  /** weekend-phase: the feed holds the race's incidents. */
  | 'feed'
  /** weekend-phase: the feed is empty (race only; `none` is its `notApplicable`, C14). */
  | 'noFeed'
  /** No entry of its own; a mini-sector that shares a frame with it can be a time loss. */
  | 'none'
  /** A neutralised entry at its start; a mini-sector that shares a frame with it is no time loss (C26). */
  | 'neutralised'
  /** No entry; a mini-sector of the car that shares a frame with it is no time loss (C26): a pit visit or a garage spell. */
  | 'noTimeLoss'
  /** A retirement entry of the car when the span opens. */
  | 'retirement'
  /** A penalty entry of kind `disqualified` when the span opens. */
  | 'disqualification'
  /** A warning entry with the span's count of the limit. */
  | 'warning';

/** A machine's rows, one per kind its declaration names (checked at compile time). */
const rows = <K extends string>(_declaration: SpanDeclaration<K>, byKind: Record<K, IncidentsBehaviour>): Record<K, IncidentsBehaviour> => byKind;

export const INCIDENTS_BEHAVIOUR = {
  'weekend-phase': rows(weekendPhaseSpans, { race: 'feed', practice: 'noFeed', qualifying: 'noFeed', none: 'noFeed' }),
  'session-phase-race': rows(sessionPhaseRaceSpans, {
    grid: 'none',
    formation: 'none',
    startLights: 'none',
    racing: 'none',
    neutralised: 'neutralised',
    suspended: 'neutralised',
    finished: 'none',
    postSession: 'none',
  }),
  'session-phase-qualifying': rows(sessionPhaseQualifyingSpans, {
    grid: 'none',
    running: 'none',
    suspended: 'neutralised',
    finished: 'none',
    postSession: 'none',
  }),
  'session-phase-practice': rows(sessionPhasePracticeSpans, {
    grid: 'none',
    running: 'none',
    suspended: 'neutralised',
    finished: 'none',
    postSession: 'none',
  }),
  'car-location': rows(carLocationSpans, { track: 'none', pitLane: 'noTimeLoss', garage: 'noTimeLoss' }),
  'car-status': rows(carStatusSpans, { competing: 'none', retired: 'retirement', disqualified: 'disqualification', absent: 'none' }),
  warnings: rows(warningsSpans, { noWarning: 'none', warned: 'warning' }),
} satisfies BehaviourTable<IncidentsBehaviour>;

/** The row of a span's kind; a kind without one is a bug in the table (C3). */
export function behaviourOf(machine: string, kind: string): IncidentsBehaviour {
  const table: BehaviourTable<IncidentsBehaviour> = INCIDENTS_BEHAVIOUR;
  const row = Object.hasOwn(table, machine) && Object.hasOwn(table[machine] ?? {}, kind) ? table[machine]?.[kind] : undefined;
  if (row === undefined) throw new Error(`incidents behaviour: no row for ${machine} ${kind}`);
  return row;
}
