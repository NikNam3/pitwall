// The `track-positions` feature (spec 6.1; C53, C55, C56): it registers the calculator and binds its one output to two
// topics with `bindState`: `trackPositions.geometry` selects `geometry`, `trackPositions.cars` selects `cars`.
import { TRACK_POSITIONS, trackPositionsCalculator, type TrackPositionsOutput } from '@pitwall/analysis';
import { TOPICS } from '@pitwall/contracts';
import type { QuickCalculator } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import type { TopicBinding } from '../../../src/features/feature.ts';
import trackPositions from '../../../src/features/track-positions/register.ts';
import { carState, engineView } from '../../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../../test-support/track.ts';
import { carId, known, type OpenSpan } from '../../../../../packages/domain/src/index.ts';

type StateBinding = Extract<TopicBinding, { from: string }>;

const bindingOf = (topic: string): StateBinding | undefined => trackPositions.topics.find((t) => t.topic === topic) as StateBinding | undefined;

/** An open span of car `car` (C20). */
const span = (machine: string, kind: string, car: number): OpenSpan => ({ machine, id: 0, kind, start: 0, confirmed: true, detail: undefined, startFrame: 1, carId: carId(car) });

/** A race on the Zandvoort track with one competing car on the track. */
const view = engineView({
  cars: [carState({ id: carId(0), timing: { lapDistanceM: 1000 } })],
  session: { trackLengthM: 4000, sector2StartM: 1500, sector3StartM: 2800 },
  situation: {
    weekendPhase: { kind: 'race', format: 'grandPrix' },
    byMachine: { 'car-status': [span('car-status', 'competing', 0)], 'car-location': [span('car-location', 'track', 0)] },
  },
  track: known(zandvoortTrack(), 0),
});

/** What a topic publishes: its binding's select over the feature's calculator output on the view. */
function published(topic: string): unknown {
  const binding = bindingOf(topic);
  expect(binding, topic).toBeDefined();
  const calc = trackPositions.calculators.find((c) => c.id === binding!.from) as QuickCalculator<TrackPositionsOutput> | undefined;
  expect(calc, binding!.from).toBeDefined();
  const out = calc!.compute(view);
  expect(binding!.select, topic).toBeTypeOf('function');
  return binding!.select!(out, {});
}

describe('track-positions feature', () => {
  it('registers the calculator track-positions and binds trackPositions.geometry and trackPositions.cars to it', () => {
    expect(trackPositions.name).toBe('track-positions');
    expect(trackPositions.calculators).toEqual([trackPositionsCalculator]);
    expect(trackPositions.topics.map((t) => t.topic).sort()).toEqual(['trackPositions.cars', 'trackPositions.geometry']);
    expect(bindingOf('trackPositions.geometry')).toMatchObject({ from: TRACK_POSITIONS });
    expect(bindingOf('trackPositions.cars')).toMatchObject({ from: TRACK_POSITIONS });
  });

  it('both topics publish through their bindings: geometry selects the output geometry, cars the output cars', () => {
    const out = trackPositionsCalculator.compute(view);
    expect(out.geometry.known).toBe(true);
    expect(out.cars.known).toBe(true);
    expect(published('trackPositions.geometry')).toEqual(out.geometry);
    expect(published('trackPositions.cars')).toEqual(out.cars);
    // the select picks one part of the output, whatever the output holds
    const geometry = bindingOf('trackPositions.geometry')!.select!({ geometry: 'g', cars: 'c' }, {});
    const cars = bindingOf('trackPositions.cars')!.select!({ geometry: 'g', cars: 'c' }, {});
    expect([geometry, cars]).toEqual(['g', 'c']);
  });

  it('the topics are owned by the calculator (C56): state topics, geometry at 1 Hz, cars at 10 Hz', () => {
    expect(TOPICS['trackPositions.geometry']).toMatchObject({ owner: 'track-positions', mode: 'state', maxHz: 1 });
    expect(TOPICS['trackPositions.cars']).toMatchObject({ owner: 'track-positions', mode: 'state', maxHz: 10 });
  });
});
