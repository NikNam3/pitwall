// `degradation` as of frame N (SP4.3a spec 6.1, Task 15a; rows R2 and R3 of Tasks 9–12): `degradationAsOf` reads the
// projection cut at N and the situation at N (`projectionAsOf`) with the run's fixed inputs, and the scheduled run is
// that form at the current frame (`asOfNow`). It reads no other unit's output, so the cut view carries none.
import { carId, type FrameNumber, type LapRecord } from '@pitwall/domain';
import { asOfNow, projectionAsOf, type AsOfView, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { degradationAsOf, degradationCalculator } from '../../src/degradation/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { engineShaped } from '../engine-shaped.ts';
import { situatedView, guardedQuick } from '../situated.ts';
import { alternating, pitStop, stintLaps, stintRecord } from './support.ts';

const calc = guardedQuick(degradationCalculator);

/** A small generator race: 6 cars (4 AI, 2 humans), 12 laps, one stop each on lap 5 to 7, a safety car in laps 8 to 9. */
const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 6,
  laps: 12,
  field: GENERATOR_DEFAULTS.field.slice(14).map((car, i) => ({ ...car, stops: [{ lap: 5 + (i % 3), compound: 'hard' as const }] })),
  sc: { fromLap: 8, toLap: 9 },
};

/** The fixed lists of the projection (log/log.ts `FACT_LISTS`). */
const LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'decisions', 'clock'] as const;

/**
 * The race's final projection with its append frames (`appendedAt`, keyed like the log's), as the engine keeps it: each
 * entry's frame is the first frame whose view holds it. The generator's views carry none, so they are read off its views.
 */
function finalProjection(race: BuilderRace): Projection {
  const appendedAt: Record<string, FrameNumber[]> = {};
  const note = (list: string, length: number, frame: FrameNumber) => {
    const frames = (appendedAt[list] ??= []);
    while (frames.length < length) frames.push(frame);
  };
  for (let frame = 1; frame <= race.lastFrame; frame++) {
    const h = race.viewAt(frame).history;
    for (const list of LISTS) note(list, h[list].length, frame);
    for (const [machine, spans] of Object.entries(h.spans)) note(`spans:${machine}`, spans.length, frame);
  }
  const last = race.viewAt(race.lastFrame).history;
  // a list with no entry has no append frames, as the engine keeps it
  return { ...last, appendedAt: Object.fromEntries(Object.entries(appendedAt).filter(([, frames]) => frames.length > 0)) } as Projection;
}

/** The frames the leader crosses the line on: the first frame of each of its laps after the first, and the last frame. */
function leaderCrossings(race: BuilderRace): FrameNumber[] {
  const frames = new Set<FrameNumber>();
  for (let lap = 2; lap <= race.laps + 1; lap++) {
    const first = race.framesOfLap(lap)[0];
    if (first !== undefined) frames.add(first);
  }
  frames.add(race.lastFrame);
  return [...frames].sort((a, b) => a - b);
}

/** The view as of `frame`, cut from the race's last frame: its projection and situation at `frame`, the fixed inputs of the run. */
function cutAt(race: BuilderRace, history: Projection, frame: FrameNumber): AsOfView {
  const source = { history, situation: race.viewAt(race.lastFrame).situation };
  return { ...asOfNow(race.viewAt(frame)), ...projectionAsOf(source, frame), frame };
}

describe('degradation as of frame N (R2)', () => {
  it('as of frame N equals the scheduled run at every leader crossing frame', () => {
    const { race } = generateRace(PARAMS, 7);
    const history = finalProjection(race);
    const crossings = leaderCrossings(race);
    expect(crossings.length).toBeGreaterThanOrEqual(PARAMS.laps);
    for (const frame of crossings) {
      const scheduled = calc.compute(race.viewAt(frame));
      expect(degradationAsOf(cutAt(race, history, frame)), `frame ${frame}`).toEqual(scheduled);
      // the scheduled run is the form at the current frame
      expect(degradationAsOf(asOfNow(race.viewAt(frame))), `frame ${frame}`).toEqual(scheduled);
    }
  });
});

describe('degradation after a flashback (R3, C33)', () => {
  /** Car `car`'s soft stint on laps 1..8 (lap 8 its in lap), then medium from lap 9 (its out lap) to `to`. */
  const carLaps = (car: number, to: number): LapRecord[] => [
    ...stintLaps({ car, from: 1, to: Math.min(8, to), nu: 80, noise: alternating(100), over: { 8: { inLap: true } } }),
    ...(to > 8 ? stintLaps({ car, from: 9, to, actual: 'C2', visual: 'medium', nu: 50, fuelAtFrom: 88, over: { 9: { outLap: true } } }) : []),
  ];
  const cars = [carState(), carState({ id: carId(1) })];

  it('rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    // before: laps 1..12 of both cars as the engine appends them (provisional, then confirmed), each car's stop at the
    // end of lap 8 with its stint record; the flashback goes back into lap 7: laps 7..12, the stops and the records
    // never happened
    const before = situatedView({
      cars: [carState({ tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 3 } }), carState({ id: carId(1), tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 3 } })],
      history: {
        laps: engineShaped([...carLaps(0, 12), ...carLaps(1, 12)]),
        stints: [stintRecord({ firstLap: 1, lastLap: 8 }), stintRecord({ carId: carId(1), firstLap: 1, lastLap: 8 })],
        pitStops: [pitStop({ lap: 8 }), pitStop({ carId: carId(1), lap: 8 })],
      },
    });
    const kept = engineShaped([...carLaps(0, 6), ...carLaps(1, 6)]);
    const after = situatedView({
      cars,
      history: { laps: kept },
      delta: { before: { laps: 48, stints: 2, pitStops: 2 }, after: { laps: 24 }, rewound: { frameId: 1_300, at: 560_000 } },
    });
    const fresh = situatedView({ cars, history: { laps: kept } });

    expect(calc.compute(before)[carId(0)]).toHaveLength(2);
    const expected = calc.compute(fresh);
    expect(expected[carId(0)]).toHaveLength(1);
    expect(calc.compute(after)).toEqual(expected);
    expect(degradationAsOf(asOfNow(after))).toEqual(expected);
    expect(degradationAsOf(asOfNow(fresh))).toEqual(expected);
  });
});
