// The weekend-phase sub-machine's transition table (contract C14, C85): one span per session, opened once the phase is
// decided and never changed. A session type that needs the weekend structure (1-17) opens it on the first frame that
// carries one (before, no span is open: the weekend phase is pending); 0, 18 and any type above 18 open `none` at once.
// The span's kind is the phase kind; its detail is the rest of the `WeekendPhase` (`format`, `segment`).
import type { WeekendPhase } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/weekend-phase/machine.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';

/** One session type with the weekend structure its Session packet carries, and the phase it decides. */
export type PhaseCase = { name: string; sessionType: number; structure: number[]; phase: WeekendPhase };

const practice = (format: 'practice' | 'shortPractice', segment: 1 | 2 | 3 | undefined): WeekendPhase => ({ kind: 'practice', format, segment });
const qualifying = (
  format: 'grandPrix' | 'short' | 'oneShot' | 'sprintShootout' | 'shortSprintShootout' | 'oneShotSprintShootout',
  segment: 1 | 2 | 3 | undefined,
): WeekendPhase => ({ kind: 'qualifying', format, segment });

/** Every session type 0-19 (19 stands for any unknown type) alone in its weekend, and the race types in the sprint weekend. */
export const PHASE_CASES: readonly PhaseCase[] = [
  { name: 'type 0, unknown', sessionType: 0, structure: [], phase: { kind: 'none' } },
  { name: 'type 1, practice 1', sessionType: 1, structure: [1], phase: practice('practice', 1) },
  { name: 'type 2, practice 2', sessionType: 2, structure: [2], phase: practice('practice', 2) },
  { name: 'type 3, practice 3', sessionType: 3, structure: [3], phase: practice('practice', 3) },
  { name: 'type 4, short practice', sessionType: 4, structure: [4], phase: practice('shortPractice', undefined) },
  { name: 'type 5, qualifying 1', sessionType: 5, structure: [5], phase: qualifying('grandPrix', 1) },
  { name: 'type 6, qualifying 2', sessionType: 6, structure: [6], phase: qualifying('grandPrix', 2) },
  { name: 'type 7, qualifying 3', sessionType: 7, structure: [7], phase: qualifying('grandPrix', 3) },
  { name: 'type 8, short qualifying', sessionType: 8, structure: [8], phase: qualifying('short', undefined) },
  { name: 'type 9, one-shot qualifying', sessionType: 9, structure: [9], phase: qualifying('oneShot', undefined) },
  { name: 'type 10, sprint shootout 1', sessionType: 10, structure: [10], phase: qualifying('sprintShootout', 1) },
  { name: 'type 11, sprint shootout 2', sessionType: 11, structure: [11], phase: qualifying('sprintShootout', 2) },
  { name: 'type 12, sprint shootout 3', sessionType: 12, structure: [12], phase: qualifying('sprintShootout', 3) },
  { name: 'type 13, short sprint shootout', sessionType: 13, structure: [13], phase: qualifying('shortSprintShootout', undefined) },
  { name: 'type 14, one-shot sprint shootout', sessionType: 14, structure: [14], phase: qualifying('oneShotSprintShootout', undefined) },
  { name: 'type 15, race alone', sessionType: 15, structure: [15], phase: { kind: 'race', format: 'grandPrix' } },
  { name: 'type 16, race 2 alone', sessionType: 16, structure: [16], phase: { kind: 'race', format: 'grandPrix' } },
  { name: 'type 17, race 3 alone', sessionType: 17, structure: [17], phase: { kind: 'race', format: 'grandPrix' } },
  { name: 'type 18, time trial', sessionType: 18, structure: [], phase: { kind: 'none' } },
  { name: 'type 19, an unknown type', sessionType: 19, structure: [], phase: { kind: 'none' } },
  { name: 'type 15 in [15, 16] is the sprint', sessionType: 15, structure: [15, 16], phase: { kind: 'race', format: 'sprint' } },
  { name: 'type 16 in [15, 16] is the grand prix', sessionType: 16, structure: [15, 16], phase: { kind: 'race', format: 'grandPrix' } },
  { name: 'type 15 in [10, 15, 16] is the sprint', sessionType: 15, structure: [10, 15, 16], phase: { kind: 'race', format: 'sprint' } },
  { name: 'type 16 in [10, 15, 16, 7] is the grand prix', sessionType: 16, structure: [10, 15, 16, 7], phase: { kind: 'race', format: 'grandPrix' } },
];
/** Any type above 18 is `none`: a few more than the single 19. */
export const UNKNOWN_TYPES: readonly number[] = [19, 20, 42, 255];

const session = (sessionType: number, structure: number[]) => (i: MachineInput): void => {
  i.signals.session.sessionType = sessionType;
  i.signals.session.weekendStructure = structure;
};

/** The phase's span kind. */
const kindOf = (phase: WeekendPhase): string => phase.kind;

/** A session whose structure is not known on the first frames (an empty one) and arrives on the last. */
const arriving = (c: PhaseCase) => inputs().frames(3, session(c.sessionType, [])).frame(session(c.sessionType, c.structure));
/** A session in progress: the first frame already carries the structure. */
const joined = (c: PhaseCase) => inputs().frame(session(c.sessionType, c.structure));

const decidedAtOnce = (c: PhaseCase): boolean => c.phase.kind === 'none';

const rows: TransitionRow[] = [
  ...PHASE_CASES.filter((c) => !decidedAtOnce(c)).map(
    (c): TransitionRow => ({ name: `${c.name}: pending until the structure arrives, then ${kindOf(c.phase)}`, from: 'none', to: kindOf(c.phase), input: arriving(c) }),
  ),
  // `none` from the session type alone, on the session's first frame, without a weekend structure.
  ...PHASE_CASES.filter(decidedAtOnce).map(
    (c): TransitionRow => ({ name: `${c.name}: none at once, no structure needed`, from: 'none', to: 'none', input: joined(c), join: true }),
  ),
  ...UNKNOWN_TYPES.map(
    (type): TransitionRow => ({ name: `type ${type} above 18 is none at once`, from: 'none', to: 'none', input: inputs().frame(session(type, [])), join: true }),
  ),
  // One join row per kind: the first frame already carries the weekend structure.
  ...PHASE_CASES.filter((c) => ['type 3, practice 3', 'type 6, qualifying 2', 'type 16 in [15, 16] is the grand prix'].includes(c.name)).map(
    (c): TransitionRow => ({ name: `joins a session in progress: ${c.name}`, from: 'none', to: kindOf(c.phase), input: joined(c), join: true }),
  ),
];

export default defineTransitionTable(machine, rows);
