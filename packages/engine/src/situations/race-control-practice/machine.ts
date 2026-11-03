// The practice race-control sub-machine (contract C9, C14, C15, C17): session-scoped, one `drsFree` span for the whole
// session (DRS is free to use; the game sends neither DRSE nor DRSD here). No signal tells whether the session was joined,
// so the span is joined (`joinedAt`), as the car-flags spans are.
import { raceControlPracticeSpans, type FrameNumber, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

type Open = { span: { start: SessionTime; startFrame: FrameNumber } | undefined };

const machine: SubMachine<Open> = {
  id: 'race-control-practice',
  appliesTo: ['practice'],
  spans: raceControlPracticeSpans,
  inputs: { signals: [], values: [], upstream: ['weekend-phase'] },
  transitions: [['none', 'drsFree']],
  init: () => ({ span: undefined }),
  openSpans: (open) =>
    open.span === undefined
      ? []
      : [{ machine: 'race-control-practice', id: 0, kind: 'drsFree', start: open.span.start, startFrame: open.span.startFrame, confirmed: true, detail: undefined, joinedAt: true }],
  step(open, input): MachineStep<Open> {
    if (open.span !== undefined) return { open, closed: [] };
    return { open: { span: { start: input.at, startFrame: input.frameNumber } }, closed: [] };
  },
};

export default machine;
