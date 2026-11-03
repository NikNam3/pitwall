// The qualifying race-control sub-machine (contract C14, C15, C17, C26): one `drsFree` span for the session. Transition row:
// race-control-qualifying.transitions.ts.
import { describe, expect, it } from 'vitest';
import { raceControlQualifyingSpans } from '@pitwall/domain';
import machine from '../../../src/situations/race-control-qualifying/machine.ts';
import { inputs } from '../../support/transition-table.ts';
import { phase } from './race-control-qualifying.transitions.ts';

describe('race-control-qualifying', () => {
  it('is the sub-machine race-control-qualifying, its spans the session-scoped declaration in domain, applies to the qualifying phase only', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['race-control-qualifying', raceControlQualifyingSpans, ['qualifying']]);
    expect(machine.spans.scope).toBe('session');
  });
  it('reads no signal, no value and no upstream sub-machine', () => {
    expect([machine.inputs.signals, machine.inputs.values, machine.inputs.upstream]).toEqual([[], [], []]);
  });
  it('opens one drsFree span on the first frame, frame number 1, and holds it for the whole session without closing anything', () => {
    let open = machine.init();
    const seen = inputs().frames(40, phase).build().map((input) => {
      const step = machine.step(open, input);
      open = step.open;
      return { open: machine.openSpans(open), closed: step.closed };
    });
    expect(seen[0]!.open).toMatchObject([{ machine: 'race-control-qualifying', id: 0, kind: 'drsFree', start: 0, startFrame: 1, confirmed: true, joinedAt: true }]);
    for (const s of seen) expect(s.open).toEqual(seen[0]!.open);
    expect(seen.flatMap((s) => s.closed)).toEqual([]);
  });
  it('a DRSE or a DRSD (the game sends none here) changes nothing: the span stays', () => {
    let open = machine.init();
    const kinds = inputs().frames(2, phase).frame((i) => { i.signals.events = [{ code: 'DRSD', reason: 'wetTrack' }, { code: 'DRSE' }]; }).frames(2).build().map((input) => {
      const step = machine.step(open, input);
      open = step.open;
      return [machine.openSpans(open).map((s) => [s.id, s.kind]), step.closed.length];
    });
    expect(kinds).toEqual(Array(5).fill([[[0, 'drsFree']], 0]));
  });
});
