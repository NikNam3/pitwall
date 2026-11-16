// The time-loss exclusion as a built-once coverage query (SP4.3c Task 25s, ruling R62, contract C26, C28, C43):
// `timeLossExcludedOf(view)` builds its indexes once, by the projection module's coverage query, and its answers stay
// those of the per-check `spansOverlapping` form it replaces (kept here as `reference`, verbatim): a car's mini-sector
// `[from, to)` (frame `from` for an empty one) is excluded when a neutralisation of the session-phase sub-machine of the
// situation's weekend phase (every session-phase sub-machine without a situation) or the car's pit visit or garage spell
// covers one of its frames. Its queries read no span of the view again after the first answer. The neutralised, pit
// and garage cases of `neutralised.test.ts` stay as they are; this file adds random span sets and the long race.
import { carId, type MachineId, type OpenSpan, type Span, type WeekendPhase } from '@pitwall/domain';
import { spansOverlapping, type EngineView } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { isNeutralisation, NEUTRALISATION_MACHINES, timeLossExcludedOf } from '../../src/shared/neutralised.ts';
import type { TimeLossExcluded } from '../../src/shared/time-loss/index.ts';

type ExclusionSource = Parameters<typeof timeLossExcludedOf>[0];

const PHASE_MACHINE: Readonly<Record<string, MachineId>> = { race: 'session-phase-race', qualifying: 'session-phase-qualifying', practice: 'session-phase-practice' };

/** The exclusion as it was before Task 25s: two `spansOverlapping` queries per check. */
function reference(view: ExclusionSource): TimeLossExcluded {
  const phaseMachine = view.situation === undefined ? undefined : PHASE_MACHINE[view.situation.weekendPhase.kind];
  const phase = view.situation === undefined ? NEUTRALISATION_MACHINES : [phaseMachine].filter((m) => m !== undefined);
  return (car, from, to) => {
    const end = Math.max(to, from + 1);
    if (phase.some((machine) => spansOverlapping(view, from, end, machine).some((s) => isNeutralisation(machine, s)))) return true;
    return spansOverlapping(view, from, end, 'car-location', car).some((s) => ['pitLane', 'garage'].includes(s.kind));
  };
}

const CARS = 4;
const KINDS: Readonly<Record<MachineId, readonly string[]>> = {
  'session-phase-race': ['racing', 'neutralised', 'suspended', 'grid'],
  'session-phase-qualifying': ['running', 'suspended'],
  'session-phase-practice': ['running', 'suspended'],
  'car-location': ['track', 'pitLane', 'garage'],
};
const MACHINES = Object.keys(KINDS);

const spanArb = fc
  .record({
    machine: fc.constantFrom(...MACHINES),
    pick: fc.nat(),
    startFrame: fc.integer({ min: 0, max: 40 }),
    length: fc.integer({ min: 0, max: 8 }),
    open: fc.boolean(),
    confirmed: fc.boolean(),
    car: fc.integer({ min: 0, max: CARS - 1 }),
  })
  .map((g) => ({ ...g, kind: KINDS[g.machine]![g.pick % KINDS[g.machine]!.length]! }));

const PHASES: readonly WeekendPhase[] = [
  { kind: 'race', format: 'grandPrix' },
  { kind: 'qualifying', format: 'oneShot', segment: undefined },
  { kind: 'practice', format: 'practice', segment: 1 },
  { kind: 'pending' },
  { kind: 'none' },
];

/** A view of generated spans: closed in the projection, open in the situation (or no situation). */
type Generated = { machine: MachineId; kind: string; startFrame: number; length: number; open: boolean; confirmed: boolean; car: number };
const viewOf = (spans: readonly Generated[], phase: WeekendPhase | undefined): ExclusionSource => {
  const closed: Record<MachineId, Span[]> = {};
  const open: Record<MachineId, OpenSpan[]> = {};
  spans.forEach((g, i) => {
    const base = { machine: g.machine, id: i, kind: g.kind, start: g.startFrame * 100, confirmed: g.confirmed, detail: undefined, startFrame: g.startFrame, ...(g.machine === 'car-location' && { carId: carId(g.car) }) };
    if (g.open && phase !== undefined) (open[g.machine] ??= []).push(base as OpenSpan);
    else (closed[g.machine] ??= []).push({ ...base, end: (g.startFrame + g.length) * 100, endFrame: g.startFrame + g.length } as Span);
  });
  const history = { spans: closed } as unknown as EngineView['history'];
  return phase === undefined ? { history } : { history, situation: { weekendPhase: phase, byMachine: open } as EngineView['situation'] };
};

describe('timeLossExcludedOf (Task 25s): built once, answers unchanged', () => {
  it('equals the per-check spansOverlapping form for random span sets, weekend phases and mini-sectors (property)', () => {
    const checkArb = fc.record({ car: fc.integer({ min: 0, max: CARS }), from: fc.integer({ min: -2, max: 55 }), len: fc.integer({ min: -1, max: 12 }) });
    fc.assert(
      fc.property(fc.array(spanArb, { maxLength: 30 }), fc.option(fc.constantFrom(...PHASES), { nil: undefined }), fc.array(checkArb, { minLength: 1, maxLength: 30 }), (spans, phase, checks) => {
        const view = viewOf(spans, phase);
        const excluded = timeLossExcludedOf(view);
        const expected = reference(view);
        for (const { car, from, len } of checks) {
          expect(excluded(carId(car), from, from + len), `car ${car} [${from}, ${from + len})`).toBe(expected(carId(car), from, from + len));
        }
      }),
      { numRuns: 400 },
    );
  });

  it('equals the per-check form on the long race at lap 70, every car and mini-sector of every third lap (the SC and every stop)', () => {
    const race = longRace();
    const frames = race.framesOfLap(70);
    const view = race.viewAt(frames[frames.length - 1]!);
    const excluded = timeLossExcludedOf(view);
    const expected = reference(view);
    const crossings = view.history.crossings;
    const last = new Map<number, number>();
    let checked = 0;
    let trues = 0;
    for (const c of crossings) {
      const from = last.get(c.carId);
      last.set(c.carId, c.frame);
      if (from === undefined || c.lap % 3 !== 0) continue;
      const want = expected(c.carId, from, c.frame);
      expect(excluded(c.carId, from, c.frame), `car ${c.carId} lap ${c.lap} segment ${c.segment}`).toBe(want);
      checked++;
      if (want) trues++;
    }
    expect(checked).toBeGreaterThan(1_000);
    expect(trues).toBeGreaterThan(0);
  });

  it('is built once: after its first answer, no check reads the view’s spans again', () => {
    let reads = 0;
    const counted = <T extends object>(o: T): T =>
      new Proxy(o, {
        get(target, key, receiver) {
          reads++;
          const value = Reflect.get(target, key, receiver) as unknown;
          return Array.isArray(value) ? counted(value) : value;
        },
      });
    const race = longRace();
    const view = race.viewAt(race.framesOfLap(40)[0]!);
    const source: ExclusionSource = {
      history: { ...view.history, spans: counted(view.history.spans) } as EngineView['history'],
      situation: { ...view.situation, byMachine: counted(view.situation.byMachine) } as EngineView['situation'],
    };
    const excluded = timeLossExcludedOf(source);
    excluded(carId(0), 1, 2);
    const afterFirst = reads;
    for (let f = 0; f < 2_000; f++) excluded(carId(f % 20), f, f + 3);
    expect(reads).toBe(afterFirst);
  });
});
