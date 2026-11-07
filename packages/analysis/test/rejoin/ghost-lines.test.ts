// `rejoin.ghostLines` (SP4.2 spec 3.2, 6.1): per our car and condition, our gapper line (`gapperLines`, shared with
// `gaps.gapper`, C43) over the last `ghostLaps` laps plus the condition's loss (positive = behind the reference), at the
// gapper's own `lap` values, and its `now` point; a condition whose loss is unknown has no line (C3). Budgets on the
// long-race builder (20 cars × 70 laps): `ghostLinesOf` under 1 ms per reference, `rejoin`'s compute under 1 ms per
// crossing of our car; the median of 50 warm runs, no raised timeout.
import { known, MINI_SECTORS, unknown, type CarId, type GapperReference, type GhostLines, type Known, type Ms, type PitCondition } from '@pitwall/domain';
import { CalculatorRegistry, type Calculator, type CalculatorId, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { ghostLinesOf } from '../../src/rejoin/ghost-lines.ts';
import { REJOIN, REJOIN_CONFIG, type GhostLinesInput } from '../../src/rejoin/index.ts';
import { gapperLines } from '../../src/shared/gapper-lines.ts';
import { ourCars } from '../../src/shared/our-cars.ts';
import { CALCULATORS } from '../units.ts';
import { rejoinCase, SEGMENT_MS, US } from './field.ts';

const LEADER: GapperReference = { kind: 'leaderAverage' };
const LOSSES: Record<PitCondition, Known<Ms>> = { green: known(20_300, 0), vsc: known(13_100, 0), sc: known(9_800, 0) };
const { ghostLaps } = REJOIN_CONFIG.defaults;

/** The standard field at lap 12.5 of ours (progress 625): well past `ghostLaps` and inside the gapper's fine laps. */
const NOW = 5_000 + 625 * SEGMENT_MS;
const TEAMMATE = 8;

const inputOf = (losses: Record<PitCondition, Known<Ms>> = LOSSES): GhostLinesInput => {
  const { gaps } = rejoinCase({ now: NOW, teammate: TEAMMATE });
  return { gaps, losses, ourCars: [US, TEAMMATE] as CarId[], ghostLaps };
};

/**
 * What the line of `car` under a loss must be: its gapper points from `lastLap − ghostLaps` on (its newest point's lap),
 * each plus the loss, at the same `lap`; its `now` point is the newest crossing's, so it is already the last of them.
 */
function expectedPoints(input: GhostLinesInput, car: CarId, lossMs: Ms): GhostLines['lines'][number]['points'] {
  const line = gapperLines(input.gaps, LEADER).cars.find((c) => c.carId === car);
  if (line === undefined) throw new Error(`no gapper line of car ${car}`);
  const last = line.points.at(-1);
  if (last === undefined) throw new Error(`car ${car} has no gapper point`);
  const points = line.points.filter((p) => p.lap >= last.lap - input.ghostLaps).map((p) => ({ lap: p.lap, gapMs: p.gapMs + lossMs }));
  if (line.now.known && line.now.value.lap !== last.lap) points.push({ lap: line.now.value.lap, gapMs: line.now.value.gapMs + lossMs });
  return points;
}

const lineOf = (lines: GhostLines, car: CarId, condition: PitCondition) => lines.lines.find((l) => l.carId === car && l.condition === condition);

describe('rejoin ghost lines', () => {
  it('leaderAverage: each of our cars has three lines, its gapper points of the last 6 laps plus each loss, per crossing', () => {
    const input = inputOf();
    const out = ghostLinesOf(input, LEADER);
    expect(out.lines).toHaveLength(6);
    for (const car of input.ourCars) {
      for (const condition of ['green', 'vsc', 'sc'] as const) {
        const line = lineOf(out, car, condition);
        const loss = LOSSES[condition];
        if (!loss.known) throw new Error('the losses are known');
        expect(line?.points, `car ${car} ${condition}`).toEqual(expectedPoints(input, car, loss.value));
        // the last 6 laps of crossings: 6 × 50 points and the newest one's own
        expect(line?.points.length, `car ${car} ${condition}`).toBe(ghostLaps * MINI_SECTORS + 1);
      }
    }
  });

  it('a condition whose loss is unknown has no line', () => {
    const out = ghostLinesOf(inputOf({ ...LOSSES, vsc: unknown('insufficientData') }), LEADER);
    expect(out.lines.map((l) => l.condition).sort()).toEqual(['green', 'green', 'sc', 'sc']);
    expect(out.lines.some((l) => l.condition === 'vsc')).toBe(false);
  });
});

/** The units `calc` reads the outputs of, and theirs, in the registry's order. */
const ORDER = CalculatorRegistry.build(CALCULATORS).order;
const upstreamOf = (calc: Calculator): Calculator[] => {
  const needed = new Set<CalculatorId>();
  const visit = (c: Calculator): void => {
    for (const dep of c.reads) {
      if (typeof dep !== 'object' || needed.has(dep.calculator)) continue;
      needed.add(dep.calculator);
      const upstream = ORDER.find((u) => u.id === dep.calculator);
      if (upstream !== undefined) visit(upstream);
    }
  };
  visit(calc);
  return ORDER.filter((u) => needed.has(u.id));
};

/** The long race's view of `frame` with the outputs of every unit `rejoin` reads, computed from scratch on it. */
function longRaceView(frame: number): EngineView {
  const race = longRace();
  const outputs = new Map<CalculatorId, unknown>();
  for (const unit of upstreamOf(rejoinCalculator as Calculator)) {
    const view = race.viewAt(frame, { outputs });
    outputs.set(unit.id, unit.kind === 'quick' ? unit.compute(view) : unit.output(unit.init(view), view));
  }
  return race.viewAt(frame, { outputs });
}

/** The median of 50 warm runs of `f`, in ms. */
function medianMs(f: () => unknown): number {
  for (let k = 0; k < 5; k++) f();
  const runs = Array.from({ length: 50 }, () => {
    const start = performance.now();
    f();
    return performance.now() - start;
  });
  return [...runs].sort((a, b) => a - b)[runs.length >> 1]!;
}

describe('rejoin budgets on the long race', () => {
  // lap 60 of the leader: the projection near its largest, every car's gapper line at its longest
  const view = longRaceView(longRace().framesOfLap(60)[10]!);

  it('rejoin computes under 1 ms per crossing of our car', () => {
    expect(rejoinCalculator.id).toBe(REJOIN);
    const out = rejoinCalculator.compute(view);
    expect(out.cars[view.live.playerCar]).toBeDefined();
    expect(medianMs(() => rejoinCalculator.compute(view))).toBeLessThan(1);
  });

  it('ghostLinesOf takes under 1 ms per reference', () => {
    const input = rejoinCalculator.compute(view).ghost;
    expect(input.ourCars).toEqual(ourCars(view.live));
    expect(ghostLinesOf(input, LEADER).lines.length).toBeGreaterThan(0);
    for (const reference of [LEADER, { kind: 'fixed', lapMs: 91_000 }, { kind: 'carAverage', carId: view.live.playerCar }] as GapperReference[]) {
      expect(medianMs(() => ghostLinesOf(input, reference)), reference.kind).toBeLessThan(1);
    }
  });
});
