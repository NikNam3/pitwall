// The top bar's phase presentation table (contract C66): session-phase kind -> label and role. Pure; the machine decided
// the situation, this only maps it. `undefined` label = hidden (a resting kind); `neutralised` resolves to SC or VSC by the car.
import type { NeutralisedDetail, OpenSpan } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';
import type * as text from '../../kit/text.ts';

export type PhaseLabel = keyof typeof text.topBar.phase;
type Row = { label: PhaseLabel | 'neutralised' | undefined; role: Role | undefined };

const hidden: Row = { label: undefined, role: undefined };
const finished: Row = { label: 'finished', role: undefined };
const suspended: Row = { label: 'red', role: 'warning' };

export const phasePresentation = {
  'session-phase-race': {
    grid: hidden,
    formation: { label: 'formation', role: undefined },
    startLights: { label: 'startLights', role: undefined },
    racing: hidden,
    neutralised: { label: 'neutralised', role: 'warning' },
    suspended,
    finished,
    postSession: finished,
  },
  'session-phase-qualifying': { grid: hidden, running: hidden, suspended, finished, postSession: finished },
  'session-phase-practice': { grid: hidden, running: hidden, suspended, finished, postSession: finished },
} as const satisfies Record<string, Record<string, Row>>;

export type PhaseMachine = keyof typeof phasePresentation;

/** The label and role of an open session-phase span; `undefined` while it is hidden. */
export function phaseOf(machine: PhaseMachine, span: OpenSpan): { label: PhaseLabel; role: Role | undefined } | undefined {
  const row = (phasePresentation[machine] as Record<string, Row>)[span.kind];
  if (row?.label === undefined) return undefined;
  if (row.label !== 'neutralised') return { label: row.label, role: row.role };
  const car = (span.detail as NeutralisedDetail | undefined)?.car;
  return { label: car === 'VSC' ? 'vsc' : 'sc', role: row.role };
}
