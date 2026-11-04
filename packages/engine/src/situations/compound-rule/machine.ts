// The compound-rule sub-machine (contract C9, C14, C15, C17, C18): per car, race only. A car holds `required` until its
// visual compound is intermediates or wets at or after the lights out (the upstream `session-phase-race` leaving grid,
// formation and startLights), which waives the rule (`waived`, C17); waived is final. Whether a car met the rule by running
// two dry compounds is a judgement for an analysis (C43). Every car slot has a span from the first frame on, joined
// (nothing tells whether the race is under way, as in car-flags).
import { compoundRuleSpans, type FrameNumber, carId as toCarId, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

type Held = { id: number; kind: 'required' | 'waived'; start: SessionTime; startFrame: number; joinedAt?: true };
type Open = { cars: Array<Held | undefined> };

const BEFORE_LIGHTS_OUT = ['grid', 'formation', 'startLights'];

const machine: SubMachine<Open> = {
  id: 'compound-rule',
  appliesTo: ['race'],
  spans: compoundRuleSpans,
  inputs: { signals: [], values: ['tyres'], upstream: ['session-phase-race'] },
  transitions: [
    ['none', 'required'],
    ['none', 'waived'],
    ['required', 'waived'],
  ],
  init: () => ({ cars: [] }),
  openSpans: (open) =>
    open.cars.flatMap((held, carId): OpenSpan[] =>
      held === undefined ? [] : [{ machine: 'compound-rule', id: held.id, carId: toCarId(carId), kind: held.kind, start: held.start, startFrame: held.startFrame as FrameNumber, confirmed: true, detail: undefined, ...(held.joinedAt ? { joinedAt: true as const } : {}) }],
    ),
  step(open, input): MachineStep<Open> {
    const afterLightsOut = !BEFORE_LIGHTS_OUT.includes(input.upstream['session-phase-race']?.[0]?.kind ?? 'grid');
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.live.cars.map((car, carId): Held => {
      const held = open.cars[carId];
      const compound = car.tyres.visualCompound;
      const wet = afterLightsOut && (compound === 'inter' || compound === 'wet');
      if (held === undefined) return { id: 0, kind: wet ? 'waived' : 'required', start: input.at, startFrame: input.frameNumber as number, joinedAt: true };
      if (held.kind === 'waived' || !wet) return held;
      closed.push({ machine: 'compound-rule', id: held.id, carId: toCarId(carId), kind: held.kind, start: held.start, end: input.at, confirmed: true, detail: undefined, startFrame: held.startFrame as FrameNumber, ...(held.joinedAt ? { joinedAt: true as const } : {}) });
      return { id: held.id + 1, kind: 'waived', start: input.at, startFrame: input.frameNumber as number };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
