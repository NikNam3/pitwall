// The compound-rule sub-machine (contract C9, C14, C15, C17, C18): per car, race only. A car holds `required` until its
// visual compound is intermediates or wets at or after the lights out (the upstream `session-phase-race` leaving grid,
// formation and startLights), which waives the rule (`waived`, C17); waived is final. Whether a car met the rule by running
// two dry compounds is a judgement for an analysis (C43). Every car slot has a span from the first frame on, joined
// (nothing tells whether the race is under way, as in car-flags).
import { compoundRuleSpans, type FrameNumber, carId as toCarId, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';
import { sameEntries } from '../same-entries.ts';

/** Per car slot: the open span, the same object while it holds (C40). */
type Open = { cars: Array<OpenSpan | undefined> };

const opening = (id: number, carId: number, kind: 'required' | 'waived', start: SessionTime, startFrame: FrameNumber, joined: boolean): OpenSpan => ({
  machine: 'compound-rule',
  id,
  carId: toCarId(carId),
  kind,
  start,
  startFrame,
  confirmed: true,
  detail: undefined,
  ...(joined ? { joinedAt: true as const } : {}),
});

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
  openSpans: (open) => open.cars.flatMap((span): OpenSpan[] => (span === undefined ? [] : [span])),
  step(open, input): MachineStep<Open> {
    const afterLightsOut = !BEFORE_LIGHTS_OUT.includes(input.upstream['session-phase-race']?.[0]?.kind ?? 'grid');
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.live.cars.map((car, carId): OpenSpan => {
      const span = open.cars[carId];
      const compound = car.tyres.visualCompound;
      const wet = afterLightsOut && (compound === 'inter' || compound === 'wet');
      if (span === undefined) return opening(0, carId, wet ? 'waived' : 'required', input.at, input.frameNumber, true);
      if (span.kind === 'waived' || !wet) return span;
      closed.push({ ...span, end: input.at });
      return opening(span.id + 1, carId, 'waived', input.at, input.frameNumber, false);
    });
    return { open: sameEntries(open.cars, cars) ? open : { cars }, closed };
  },
};

export default machine;
