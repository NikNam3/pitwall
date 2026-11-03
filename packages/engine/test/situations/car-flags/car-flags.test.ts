// The car-flags sub-machine (contract C9, C12, C15, C17, C18, C26, C85): per car, one span per flag race control shows it
// (signal `fiaFlag`), a new span on every change; shared by every weekend phase; its spans declared in domain
// (`carFlagsSpans`); and the committed segments practice-miami-yellow (a yellow, a green, then none) and race-mexico-blue
// (blue flags for lapped cars). The transition rows are in car-flags.transitions.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { carFlagsSpans, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/car-flags/machine.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { expectSequence, ofCar, replaySpans, sequenceOf } from '../../support/segment-spans.ts';
import { FLAG_OF, KINDS, shows } from './car-flags.transitions.ts';

/** Steps the machine through the frames: the open spans after each, and every span closed on the way. */
const run = (builder: ReturnType<typeof inputs>) => {
  let open = machine.init();
  const closed: Array<Omit<Span, 'endFrame'>> = [];
  const after = builder.build().map((input) => {
    const step = machine.step(open, input);
    open = step.open;
    closed.push(...step.closed);
    return machine.openSpans(open);
  });
  return { after, closed };
};

describe('car-flags: id, span declaration, inputs, applies to', () => {
  it('is the sub-machine car-flags, its spans the car-scoped declaration in domain, shared by every phase, reading the fiaFlag signal', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['car-flags', carFlagsSpans, 'all']);
    expect(machine.spans.scope).toBe('car');
    expect(machine.inputs).toEqual({ signals: ['fiaFlag'], values: [], upstream: [] });
  });
  it('declares every kind of its spans: the game’s none is noFlag, its unknown is unknown (C3)', () => {
    expect([...carFlagsSpans.kinds].sort()).toEqual([...KINDS].sort());
    expect(FLAG_OF.noFlag).toBe('none');
  });
});

describe('car-flags: one span per car from the first frame', () => {
  it('opens a span for every car slot on the first frame, each on the car’s flag, with its car, frame and id 0', () => {
    const { after } = run(inputs().frame((i) => shows(1, 'yellow')(i)));
    const opened = after[0]!;
    expect(opened).toHaveLength(inputs().frame().build()[0]!.signals.cars.length);
    expect(opened.map((s) => s.carId)).toEqual(opened.map((_, car) => car));
    expect(opened.map((s) => s.kind)).toEqual(opened.map((_, car) => (car === 1 ? 'yellow' : 'noFlag')));
    for (const s of opened) expect([s.id, s.start, s.startFrame, s.confirmed, s.detail, s.joinedAt]).toEqual([0, 0, 1, true, undefined, true]);
  });
});

describe('car-flags: a new span on every change of the car’s flag', () => {
  it('keeps the span while the flag stays; a change closes it on that frame and opens the next with the next id of the car', () => {
    const { after, closed } = run(inputs().frames(3, shows(0, 'noFlag')).frame(shows(0, 'yellow')).frames(2, () => {}).frame(shows(0, 'green')));
    expect(closed).toEqual([
      { machine: 'car-flags', id: 0, carId: 0, kind: 'noFlag', start: 0, end: 3 * FRAME_MS, confirmed: true, detail: undefined, startFrame: 1, joinedAt: true },
      { machine: 'car-flags', id: 1, carId: 0, kind: 'yellow', start: 3 * FRAME_MS, end: 6 * FRAME_MS, confirmed: true, detail: undefined, startFrame: 4 },
    ]);
    expect(after.map((open) => open.find((s) => s.carId === 0)!.id)).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(after.at(-1)!.find((s) => s.carId === 0)).toMatchObject({ kind: 'green', start: 6 * FRAME_MS, startFrame: 7 });
  });
  it('a change of one car leaves the spans and ids of every other car as they were', () => {
    const { after, closed } = run(inputs().frame().frame(shows(0, 'blue')).frame(shows(1, 'yellow')).frame(shows(0, 'noFlag')));
    expect(closed.map((s) => [s.carId, s.id, s.kind])).toEqual([[0, 0, 'noFlag'], [1, 0, 'noFlag'], [0, 1, 'blue']]);
    const last = after.at(-1)!;
    expect(last.filter((s) => s.carId! > 1).map((s) => [s.id, s.startFrame])).toEqual(last.filter((s) => s.carId! > 1).map(() => [0, 1]));
    expect([0, 1].map((car) => last.find((s) => s.carId === car)).map((s) => [s!.carId, s!.id, s!.kind])).toEqual([[0, 2, 'noFlag'], [1, 1, 'yellow']]);
  });
  it('withdraws nothing: every span it closes or holds is confirmed (C18)', () => {
    const { after, closed } = run(inputs().frames(2, shows(0, 'green')).frame(shows(0, 'blue')).frame(shows(0, 'unknown')));
    expect([...closed, ...after.flat()].every((s) => s.confirmed)).toBe(true);
  });
});

describe('car-flags: practice-miami-yellow (the player’s yellow flag, a green, then none; MiP 134.6 / 143.8 / 148.0 s)', () => {
  let spans: readonly Span[];
  beforeAll(async () => {
    spans = await replaySpans('practice-miami-yellow.pwrec.gz', 'car-flags');
  });
  it('the player’s car (19) is noFlag, then yellow, green, noFlag at the game’s changes', () => {
    expectSequence(sequenceOf(spans, ofCar(19)), [['noFlag', 130], ['yellow', 134.6], ['green', 143.8], ['noFlag', 148.0]]);
  });
  it('every other car stays noFlag in one span', () => {
    const others = [...new Set(spans.map((s) => s.carId))].filter((car) => car !== 19);
    expect(others.length).toBeGreaterThan(10);
    for (const car of others) expect(sequenceOf(spans, ofCar(car!)).map(([kind]) => kind), `car ${car}`).toEqual(['noFlag']);
  });
});

describe('car-flags: race-mexico-blue (blue flags for lapped cars; MxR 6763.9 to 6774.5 s)', () => {
  let spans: readonly Span[];
  beforeAll(async () => {
    spans = await replaySpans('race-mexico-blue.pwrec.gz', 'car-flags');
  });
  it('car 18 is noFlag, blue, noFlag again; cars 15 and 19 turn blue and stay so to the segment’s end', () => {
    expectSequence(sequenceOf(spans, ofCar(18)), [['noFlag', 6763.7], ['blue', 6763.9], ['noFlag', 6774.5]], 0.5);
    expectSequence(sequenceOf(spans, ofCar(15)), [['noFlag', 6763.7], ['blue', 6768.6]]);
    expectSequence(sequenceOf(spans, ofCar(19)), [['noFlag', 6763.7], ['blue', 6768.9]]);
  });
  it('every other car stays noFlag in one span', () => {
    const others = [...new Set(spans.map((s) => s.carId))].filter((car) => ![15, 18, 19].includes(car!));
    expect(others.length).toBeGreaterThan(10);
    for (const car of others) expect(sequenceOf(spans, ofCar(car!)).map(([kind]) => kind), `car ${car}`).toEqual(['noFlag']);
  });
});
