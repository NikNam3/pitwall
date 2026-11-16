// `strategy-overview` (SP4.3d spec §6.4, SP4.3d1 Task 9): per our car the competing cars within one green pit loss ahead
// or behind it, plus its teammate always, in race order. The loss is `pit-loss`'s, the gaps `gaps`', a rival's window
// and next-compound odds `rival-stops`' (C43: no own copy); our rows carry the plans from the projection's decisions
// (A = the active slot). Built races (the `rejoin` field: every car laps at one pace from its own start offset, so the
// gap of any two cars at the same point of the road is the difference of their offsets, exact to the ms); `gaps` runs
// on the crossings; every case runs through the guarded view (C41).
import { carId, known, unknown, type CarId, type DecisionRecord, type Ms, type OverviewRow, type Policy, type RivalStop, type RivalStops, type StrategyOverview } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { GAPS } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { RIVAL_STOPS } from '../../src/rival-stops/index.ts';
import { strategyOverviewCalculator } from '../../src/strategy-overview/calculator.ts';
import { STRATEGY_OVERVIEW, type StrategyOverviewOutput } from '../../src/strategy-overview/index.ts';
import { carsFor, run, viewOf, type StatusKind } from '../gaps/race.ts';
import { fieldCrossings, pitLosses, type Field } from '../rejoin/field.ts';
import { guardedQuick } from '../situated.ts';
import { loadUnitFolders } from '../units.ts';

const calc = guardedQuick(strategyOverviewCalculator);

/** Our car: the player's. */
const US = 0;
/** Our teammate, 40 s behind us. */
const TEAMMATE = 5;
/** The green pit loss. */
const LOSS: Ms = 21_800;
const NOW = 230_000;

/**
 * The field (start offsets, ms; ours 30 000): car 1 30 s ahead (out), car 2 20 s ahead (in), car 6 10 s behind but
 * retired (out), car 3 21 s behind (in), car 4 23 s behind (out), our teammate car 5 40 s behind (in).
 */
const FIELD: Field = { 1: 0, 2: 10_000, 0: 30_000, 6: 40_000, 3: 51_000, 4: 53_000, 5: 70_000 };
const RETIRED = 6;

/** A rival's next stop as `rival-stops` gives it. */
const rivalStop = (lowLap: number, midLap: number, highLap: number, odds: RivalStop['nextCompound']): RivalStop => ({
  owesStop: known(true, 0),
  window: known({ lowLap, midLap, highLap, toFlag: false }, 0),
  nextCompound: odds,
  basis: 'peers',
  switchLap: unknown('insufficientData'),
  switchTo: unknown('insufficientData'),
});

/** `rival-stops`' output: car 3 stops laps 16–23, likeliest 19, then hards at 80 %; car 2 laps 12–15. */
const RIVAL_STOPS_OUT: RivalStops = {
  [carId(2)]: rivalStop(12, 13, 15, known({ hard: 0.6, medium: 0.4 }, 0)),
  [carId(3)]: rivalStop(16, 19, 23, known({ hard: 0.8, medium: 0.2 }, 0)),
} as RivalStops;

const PLAN_A: Policy = { stops: [{ lap: 22, compound: 'hard' }] };
const PLAN_B: Policy = { stops: [{ lap: 15, compound: 'hard' }, { lap: 30, compound: 'medium' }] };

/** Our plans: A and B saved, then B committed as the active plan. */
const DECISIONS: DecisionRecord[] = [
  { kind: 'planSaved', carId: carId(US), slot: 'A', policy: PLAN_A, frame: 1 },
  { kind: 'planSaved', carId: carId(US), slot: 'B', policy: PLAN_B, frame: 2 },
  { kind: 'planCommitted', carId: carId(US), slot: 'B', policy: PLAN_B, frame: 3 },
];

/** The view the overview sees: the field's crossings, car 6 retired, `gaps` over them, the loss, `rival-stops`, our decisions. */
function overviewView(o: { status?: Record<number, StatusKind> } = {}): EngineView {
  const ms = fieldCrossings(FIELD, NOW);
  const base = viewOf(ms, { cars: carsFor(ms), playerCar: US, teammateCar: TEAMMATE, status: o.status ?? { [RETIRED]: 'retired' } });
  return {
    ...base,
    history: { ...base.history, decisions: DECISIONS },
    outputs: new Map<string, unknown>([
      [GAPS, run(base)],
      [PIT_LOSS, pitLosses({ green: LOSS })],
      [RIVAL_STOPS, RIVAL_STOPS_OUT],
    ]),
  };
}

/** Car `car`'s overview; it must be present. */
const overviewOf = (out: StrategyOverviewOutput, car: number = US): StrategyOverview => {
  const o = out.cars[carId(car)];
  if (o === undefined) throw new Error(`no overview of car ${car}`);
  return o;
};

const rowsOf = (o: { status?: Record<number, StatusKind> } = {}): OverviewRow[] => overviewOf(calc.compute(overviewView(o))).rows;

const rowOf = (rows: readonly OverviewRow[], car: number): OverviewRow => {
  const row = rows.find((r) => r.carId === carId(car));
  if (row === undefined) throw new Error(`no row of car ${car}`);
  return row;
};

const ids = (rows: readonly OverviewRow[]): number[] => rows.map((r) => r.carId as CarId as number);

describe('strategy-overview analysis', () => {
  it('is the quick analysis `strategy-overview` over pit-loss, gaps, rival-stops, the stints, the decisions, session phase and car status', () => {
    expect(strategyOverviewCalculator.id).toBe(STRATEGY_OVERVIEW);
    expect(strategyOverviewCalculator.kind).toBe('quick');
    expect(strategyOverviewCalculator.reads).toEqual(
      expect.arrayContaining([{ calculator: PIT_LOSS }, { calculator: GAPS }, { calculator: RIVAL_STOPS }, 'stints', 'decisions', 'spans:session-phase-race', 'spans:car-status']),
    );
  });

  it('exports its behaviour table over session-phase-race and car-status (C44)', async () => {
    const folder = (await loadUnitFolders()).find((f) => f.unit === STRATEGY_OVERVIEW);
    expect(folder?.table).toBeDefined();
    expect(Object.keys(folder?.table ?? {}).sort()).toEqual(['car-status', 'session-phase-race']);
  });

  it("gives each of our cars an overview with `pit-loss`'s green loss", () => {
    const out = calc.compute(overviewView());
    expect(Object.keys(out.cars).map(Number).sort((a, b) => a - b)).toEqual([US, TEAMMATE]);
    expect(overviewOf(out).carId).toBe(carId(US));
    expect(overviewOf(out).lossMs).toMatchObject({ known: true, value: LOSS });
  });

  it('a car 21 s behind with a 21.8 s loss is in, its gap +21.0 s', () => {
    const row = rowOf(rowsOf(), 3);
    expect(row.gapMs).toMatchObject({ known: true, value: 21_000 });
  });

  it('a car 20 s ahead is in, its gap −20.0 s', () => {
    expect(rowOf(rowsOf(), 2).gapMs).toMatchObject({ known: true, value: -20_000 });
  });

  it('a car 23 s behind is out; a car 30 s ahead is out', () => {
    const rows = ids(rowsOf());
    expect(rows).not.toContain(4);
    expect(rows).not.toContain(1);
  });

  it('the teammate 40 s away is in', () => {
    expect(ids(rowsOf())).toContain(TEAMMATE);
  });

  it('a retired car is out, though 10 s behind (Review Focus 5)', () => {
    expect(ids(rowsOf())).not.toContain(RETIRED);
  });

  it('the same car competing 10 s behind is in', () => {
    expect(ids(rowsOf({ status: {} }))).toContain(RETIRED);
  });

  it('the rows are in race order, our own car among them', () => {
    expect(ids(rowsOf())).toEqual([2, US, 3, TEAMMATE]);
    const positions = rowsOf().map((r) => r.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("a rival's window and next-compound odds equal `rival-stops`'", () => {
    const row = rowOf(rowsOf(), 3);
    expect(row.window).toMatchObject({ known: true, value: { lowLap: 16, midLap: 19, highLap: 23 } });
    expect(row.nextCompound).toEqual(RIVAL_STOPS_OUT[carId(3)]!.nextCompound);
    expect(rowOf(rowsOf(), 2).window).toMatchObject({ known: true, value: { lowLap: 12, midLap: 13, highLap: 15 } });
  });

  it("our row's plan A is the active slot; a rival's row has no plan", () => {
    const rows = rowsOf();
    const ours = rowOf(rows, US);
    expect(ours.plan).not.toBeNull();
    expect(ours.plan?.a).toEqual(PLAN_B);
    expect(rowOf(rows, 3).plan).toBeNull();
  });
});
