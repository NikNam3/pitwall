// CarState.updatedAt: the session time of the last frame whose packet of a data source carried data for the car.
// The UI greys out a value when its source has not updated it for a few of the source's expected intervals.
import { describe, expect, it } from 'vitest';
import { toSessionTime, type CarState, type DataSource } from '@pitwall/domain';
import { initialState, step, type Frame } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

const FIRST = toSessionTime(1);
const LATER = toSessionTime(5);

/** The packets of a frame that are kept or removed to say "a frame with only these sources". */
const SOURCES = ['lapData', 'motion', 'telemetry', 'status', 'motionEx', 'damage', 'setups', 'participants', 'tyreSets', 'sessionHistory'] as const satisfies readonly DataSource[];
const ALL_AT = (at: number): Partial<Record<DataSource, number>> => Object.fromEntries(SOURCES.map((s) => [s, at]));
/** What only the player's car has. */
const OWN_ONLY: readonly DataSource[] = ['motionEx', 'setups'];

/** One frame (session time 1 s) that carries every source for both cars. */
const fullFrame = (): Frame => ({
  ...new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
    d.add('carDamage');
    d.add('carSetups');
    d.add('tyreSets', { carIdx: 0 });
    d.add('tyreSets', { carIdx: 1 });
    d.add('sessionHistory', { carIdx: 0 });
    d.add('sessionHistory', { carIdx: 1 });
  }).build()[0]!,
  sessionTime: FIRST,
});

/** The frame at session time 5 s with only the named sources. */
const only = (frame: Frame, keep: readonly DataSource[]): Frame => {
  const bare: Frame = {
    ...frame,
    sessionTime: LATER,
    tyreSets: keep.includes('tyreSets') ? frame.tyreSets : [],
    sessionHistory: keep.includes('sessionHistory') ? frame.sessionHistory : [],
    events: [],
  };
  for (const field of SOURCES) {
    if (field === 'tyreSets' || field === 'sessionHistory' || keep.includes(field)) continue;
    Reflect.deleteProperty(bare, field);
  }
  return bare;
};

/** The state after the full frame; the player is car 0. */
const afterFull = () => {
  const full = fullFrame();
  const st = initialState(initFor([full]));
  step(st, full);
  return { full, st };
};
const updated = (st: { cars: CarState[] }, car: number) => st.cars[car]!.updatedAt;

describe('updatedAt: a new car', () => {
  it('starts empty', () => {
    const full = fullFrame();
    const st = initialState(initFor([full]));
    expect(st.cars.map((c) => c.updatedAt)).toEqual(st.cars.map(() => ({})));
  });
});

describe('updatedAt: the frame time of a source moves only for the sources the frame carries', () => {
  it('the full frame sets every source for the player car and every source but the own-car ones for another car', () => {
    const { st } = afterFull();
    expect(updated(st, 0)).toStrictEqual(ALL_AT(FIRST));
    expect(updated(st, 1)).toStrictEqual(Object.fromEntries(Object.entries(ALL_AT(FIRST)).filter(([s]) => !OWN_ONLY.includes(s as DataSource))));
  });

  it.each(SOURCES)('%s: a frame with only this packet sets only this source to the frame time', (source) => {
    const { full, st } = afterFull();
    step(st, only(full, [source]));
    expect(updated(st, 0)).toStrictEqual({ ...ALL_AT(FIRST), [source]: LATER });
    const second = { ...ALL_AT(FIRST), ...(OWN_ONLY.includes(source) ? {} : { [source]: LATER }) };
    for (const own of OWN_ONLY) Reflect.deleteProperty(second, own);
    expect(updated(st, 1)).toStrictEqual(second);
  });

  it('a frame without any of the sources leaves updatedAt as it was', () => {
    const { full, st } = afterFull();
    const before = structuredClone(st.cars.map((c) => c.updatedAt));
    step(st, only(full, []));
    expect(st.cars.map((c) => c.updatedAt)).toStrictEqual(before);
  });

  it('a source is not set for a car on a frame that lacks the packet, though other packets arrive', () => {
    const { full, st } = afterFull();
    step(st, only(full, ['lapData', 'telemetry', 'status']));
    expect(updated(st, 0)).toMatchObject({ lapData: LATER, telemetry: LATER, status: LATER, motion: FIRST, damage: FIRST, participants: FIRST });
  });

  it('a car that never had a source has no entry for it', () => {
    const frame = only(fullFrame(), ['lapData']);
    const st = initialState(initFor([frame]));
    step(st, frame);
    expect(updated(st, 0)).toStrictEqual({ lapData: LATER });
  });
});

describe('updatedAt: the player-only sources', () => {
  it('MotionEx and setups reach only the player car', () => {
    const { full, st } = afterFull();
    step(st, only(full, ['motionEx', 'setups']));
    expect(updated(st, 0).motionEx).toBe(LATER);
    expect(updated(st, 0).setups).toBe(LATER);
    expect(updated(st, 1)).not.toHaveProperty('motionEx');
    expect(updated(st, 1)).not.toHaveProperty('setups');
  });
});

describe('updatedAt: the rotating packets name one car', () => {
  it.each(['tyreSets', 'sessionHistory'] as const)('%s: only the car the packet names moves', (source) => {
    const { full, st } = afterFull();
    const frame = only(full, [source]);
    const one: Frame = { ...frame, [source]: frame[source].filter((p) => p.carIdx === 1) };
    step(st, one);
    expect(updated(st, 1)[source]).toBe(LATER);
    expect(updated(st, 0)[source]).toBe(FIRST);
  });

  it.each(['tyreSets', 'sessionHistory'] as const)('%s: a packet for a slot the state lacks changes no car', (source) => {
    const { full, st } = afterFull();
    const frame = only(full, [source]);
    const before = structuredClone(st.cars.map((c) => c.updatedAt));
    step(st, { ...frame, [source]: frame[source].map((p) => ({ ...p, carIdx: 200 })) });
    expect(st.cars.map((c) => c.updatedAt)).toStrictEqual(before);
  });
});
