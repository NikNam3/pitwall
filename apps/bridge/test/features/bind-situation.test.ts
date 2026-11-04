// `bindSituation` (C55): a core topic of a sub-machine's open spans (C54), as they are. Checked twice:
// `pnpm typecheck` compiles this file, so the `@ts-expect-error` lines are the compiler tests (an expectation on a line
// that compiles is itself an error); vitest runs the same calls and checks the runtime shape of what the helper returns.
//
// The situation topics (`situation.<camelMachineId>`, Task 23) carry `MachineSpans` and compile; every other topic
// carries another value and does not. That the binding publishes a machine's open spans, and what a client
// holds after a flashback, is in `situations/situations.test.ts`. The binding does not tie the machine to its topic:
// `MachineId` is a string, so a situation topic compiles with any machine (Task 23 ruling 5).
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { MachineSpans, TopicValue } from '@pitwall/contracts';
import type { OpenSpan } from '@pitwall/domain';
import { bindSituation, defineFeature, type TopicBinding } from '../../src/features/feature.ts';

describe('bindSituation: the topic must carry a sub-machine\'s spans (C55)', () => {
  it('a topic of another value does not compile, whatever the machine', () => {
    // @ts-expect-error laps carries LapRecords, not a machine's spans
    const laps = bindSituation('laps', 'clock');
    // @ts-expect-error session.info carries SessionInfo
    const info = bindSituation('session.info', 'clock');
    // @ts-expect-error stints carries StintRecords, not spans
    const stints = bindSituation('stints', 'session-phase-race');
    // @ts-expect-error car.detail carries a car's live state
    const car = bindSituation('car.detail', 'car-location');
    // @ts-expect-error an analysis topic carries its analysis's output
    const moment = bindSituation('raceMoment.current', 'session-phase-race');
    expect([laps, info, stints, car, moment].map((b) => b.topic)).toEqual(['laps', 'session.info', 'stints', 'car.detail', 'raceMoment.current']);
  });

  it('a situation topic compiles: its value is MachineSpans, the open spans only', () => {
    expectTypeOf<MachineSpans>().toEqualTypeOf<{ open: OpenSpan[] }>();
    expectTypeOf<TopicValue<'situation.clock'>>().toEqualTypeOf<MachineSpans>();
    expectTypeOf<TopicValue<'situation.carActivityRace'>>().toEqualTypeOf<MachineSpans>();
    const clock = bindSituation('situation.clock', 'clock');
    const activity = bindSituation('situation.carActivityRace', 'car-activity-race');
    expect([clock, activity]).toEqual([
      { topic: 'situation.clock', fromSituation: 'clock' },
      { topic: 'situation.carActivityRace', fromSituation: 'car-activity-race' },
    ]);
  });

  it('the binding is a TopicBinding that names the topic and the machine', () => {
    const binding = bindSituation('situation.sessionPhaseRace', 'session-phase-race');
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toEqual({ topic: 'situation.sessionPhaseRace', fromSituation: 'session-phase-race' });
  });

  it('Feature.topics accepts what the helper returns, but no hand-written situation binding', () => {
    const binding = bindSituation('situation.clock', 'clock');
    const feature = defineFeature({ name: 'typed', calculators: [], topics: [binding] });
    expect(feature.topics).toEqual([{ topic: 'situation.clock', fromSituation: 'clock' }]);
    const handWritten = defineFeature({
      name: 'hand-written-situation',
      calculators: [],
      // @ts-expect-error a binding must come from a helper
      topics: [{ topic: 'situation.clock', fromSituation: 'clock' }],
    });
    expect(handWritten.topics).toHaveLength(1);
  });
});
