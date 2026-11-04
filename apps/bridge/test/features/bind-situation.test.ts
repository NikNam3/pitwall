// `bindSituation` (C55): a core topic of a sub-machine's spans (C54), open and closed, as they are. Checked twice:
// `pnpm typecheck` compiles this file, so the `@ts-expect-error` lines are the compiler tests (an expectation on a line
// that compiles is itself an error); vitest runs the same calls and checks the runtime shape of what the helper returns.
//
// No topic of a machine's spans exists yet: Task 23 creates the situation topics, and with its first one the rows that
// a matching topic compiles and that the binding publishes a machine's open and closed spans (and resends them after a
// flashback). Here every existing topic carries another value, so none compiles.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { bindSituation, defineFeature, type TopicBinding } from '../../src/features/feature.ts';

describe('bindSituation: the topic must carry a sub-machine\'s spans (C55)', () => {
  it('a topic of another value does not compile, whatever the machine', () => {
    // @ts-expect-error laps carries LapRecords, not a machine's spans
    const laps = bindSituation('laps', 'clock');
    // @ts-expect-error session.info carries SessionInfo
    const info = bindSituation('session.info', 'clock');
    // @ts-expect-error flagPhases carries the legacy flag phases, not spans
    const flags = bindSituation('flagPhases', 'session-phase-race');
    // @ts-expect-error car.detail carries a car's live state
    const car = bindSituation('car.detail', 'car-location');
    // @ts-expect-error an analysis topic carries its analysis's output
    const moment = bindSituation('raceMoment.current', 'session-phase-race');
    expect([laps, info, flags, car, moment].map((b) => b.topic)).toEqual(['laps', 'session.info', 'flagPhases', 'car.detail', 'raceMoment.current']);
  });

  it('the binding is a TopicBinding that names the topic and the machine', () => {
    // @ts-expect-error no topic of a machine's spans exists before Task 23; the runtime shape is checked all the same
    const binding = bindSituation('events', 'clock');
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toEqual({ topic: 'events', fromSituation: 'clock' });
  });

  it('Feature.topics accepts what the helper returns, but no hand-written situation binding', () => {
    // @ts-expect-error as above: the topic does not match, the binding is still a helper's
    const binding = bindSituation('laps', 'clock');
    const feature = defineFeature({ name: 'typed', calculators: [], topics: [binding] });
    expect(feature.topics).toEqual([{ topic: 'laps', fromSituation: 'clock' }]);
    const handWritten = defineFeature({
      name: 'hand-written-situation',
      calculators: [],
      // @ts-expect-error a binding must come from a helper
      topics: [{ topic: 'laps', fromSituation: 'clock' }],
    });
    expect(handWritten.topics).toHaveLength(1);
  });
});
