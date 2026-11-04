// The qualifying race-control sub-machine (contract C9, C14, C15, C17): session-scoped, one `drsFree` span for the whole
// session (DRS is free to use; the game sends neither DRSE nor DRSD here). No signal tells whether the session was joined,
// so the span is joined (`joinedAt`), as the car-flags spans are.
import { raceControlQualifyingSpans, type OpenSpan } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

/** The session's one span, once open (the same object from then on, C40). */
type Open = { span: OpenSpan | undefined };

const machine: SubMachine<Open> = {
  id: 'race-control-qualifying',
  appliesTo: ['qualifying'],
  spans: raceControlQualifyingSpans,
  inputs: { signals: [], values: [], upstream: ['weekend-phase'] },
  transitions: [['none', 'drsFree']],
  init: () => ({ span: undefined }),
  openSpans: (open) => (open.span === undefined ? [] : [open.span]),
  step(open, input): MachineStep<Open> {
    if (open.span !== undefined) return { open, closed: [] };
    return { open: { span: { machine: 'race-control-qualifying', id: 0, kind: 'drsFree', start: input.at, startFrame: input.frameNumber, confirmed: true, detail: undefined, joinedAt: true } }, closed: [] };
  },
};

export default machine;
