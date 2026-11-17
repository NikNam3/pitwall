// The race's job on the grid (SP4.3d2 Task 9 rows 3 and 5; SP4.3d spec §7.1 steps 7–8; C3, C43, C44): the race's
// strategy job prefills slots A and B (`prefillOf`, the planning job's rule) only while `session-phase-race` is `grid`
// or `formation` (its behaviour table, C44); from the start on its prefill is `{}`. A slot whose `startCompound` differs
// from the car's fitted compound, or names a compound without a fresh set, is `infeasible: 'startCompound'`, still a
// row, played with the fitted compound. The race's output has no `planning` (`null`). The race and views of
// `./support.ts`; every `race-monte-carlo` call is recorded (the real search runs), as in `slots.test.ts`.
//
// How these rows read the job (the test agent's decisions, Task 9):
// - "On the grid" is the race's view at the leader's first frame (`frameOf(race, 1, 0)`; Task 7: the starting point
//   builds on the race's grid before the leader's lap 2) with its open `session-phase-race` span recast as `grid` (or
//   `formation`); the builder opens `startLights` at once. This file's grid rows need Task 7 merged.
// - On the grid no car has a race lap, so its pace is `weekend-pace`'s (C3: without one the start is unknown; ruling
//   R28): the grid view carries an earlier qualifying session of the weekend (`view.weekend`, C62), every race car
//   matched by its team and race number and holding valid qualifying laps.
// - "On racing" is the view at the leader's lap 3 as `slots.test.ts` takes it (its span `racing`).
// - The fitted compound of our car is its fitted set's visual compound (`tyre-model`'s `fittedCompound`, R22): the
//   first set of the view's sets (`fittedIdx` 0). "Played with the fitted compound": the slot's candidate starts on the
//   fitted compound (its `startCompound` the fitted one, or none), its stops as saved.
import { carId, type CarId, type FrameNumber, type LapRecord, type McRow, type NoiseCompound, type Policy, type Slot, type Span, type StrategyOutput, type TyreSet } from '@pitwall/domain';
import { createRng, type EngineView, type StoredSession, type WeekendContext } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { history, lap } from '../../../../test-support/builders/index.ts';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { prefillOf, prepareStrategy, runStrategy } from '../../src/strategy/index.ts';
import { frameOf, json, plannedIn, PLAYER, RACE, SETS, viewAt, viewAtFrame, type ViewSpec } from './support.ts';

const calls = vi.hoisted(() => ({ list: [] as { input: McInput; result: McResult }[] }));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      const result = real.raceMonteCarlo(...args);
      calls.list.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.list = [];
});

const SEED = 1_521_242_744;

/** `view` with its open race session-phase span recast as `kind`. */
function inPhase(view: EngineView, kind: 'grid' | 'formation'): EngineView {
  const byMachine = { ...view.situation.byMachine };
  const open = byMachine['session-phase-race'] ?? [];
  expect(open.length, 'an open race session-phase span').toBe(1);
  byMachine['session-phase-race'] = open.map((s) => ({ ...s, kind }));
  return { ...view, situation: { ...view.situation, byMachine } as EngineView['situation'] };
}

/** A qualifying lap of car `car` (valid, on softs, a qualifying fuel load), as `weekend-pace`'s tests build them. */
const qualiLap = (car: CarId, lapNumber: number, lapTimeMs: number): LapRecord =>
  lap({ carId: car, lapNumber, lapTimeMs, completedAt: lapNumber * 100_000 + car * 1_000, actualCompound: 'C4', visualCompound: 'soft', fuelAtStartKg: { known: true, value: 10, at: lapNumber * 100_000 }, valid: { lap: true, sectors: [true, true, true] } });

/**
 * The weekend's earlier qualifying session of `view`'s race (C62): every car with Participants in the race, keyed by its
 * team and race number there, with three valid push laps (laps 2 to 4) about 1.5 s under its race pace, slower per slot.
 */
function qualifyingBefore(view: EngineView): WeekendContext {
  const seated = view.live.cars.filter((c) => c.updatedAt.participants !== undefined);
  const closed = (machine: string, kind: string, detail: unknown, car?: CarId): Span => ({
    machine,
    id: 0 as Span['id'],
    kind,
    start: 0,
    end: 3_600_000,
    confirmed: true,
    detail,
    startFrame: 1 as FrameNumber,
    endFrame: 50_000 as FrameNumber,
    ...(car !== undefined && { carId: car }),
  });
  const laps = seated.flatMap((c) => [2, 3, 4].map((n) => qualiLap(c.id, n, 88_500 + 120 * c.id + 50 * (n - 2))));
  const spans = {
    'weekend-phase': [closed('weekend-phase', 'qualifying', { format: 'grandPrix', segment: 3 })],
    'car-status': seated.map((c) => closed('car-status', 'competing', undefined, c.id)),
  };
  const session: StoredSession = {
    sessionUid: 'quali' as StoredSession['sessionUid'],
    playerCar: carId(view.live.playerCar),
    cars: seated.map((c) => ({ carId: c.id, carKey: { teamId: c.identity.teamId, raceNumber: c.identity.raceNumber } })),
    projection: history({ laps, spans }),
  };
  const player = seated.find((c) => c.id === view.live.playerCar)!;
  return { weekendId: 'w1', player: { teamId: player.identity.teamId, raceNumber: player.identity.raceNumber }, sessions: [session] };
}

/** The race's view on the grid (or in the formation lap), with the weekend's qualifying before it (R28). */
function onGrid(spec: ViewSpec = {}, kind: 'grid' | 'formation' = 'grid'): EngineView {
  const view = inPhase(viewAtFrame(RACE(), frameOf(RACE(), 1, 0), spec), kind);
  return { ...view, weekend: qualifyingBefore(view) };
}
/** The race's view at the leader's lap 3, racing. */
const racing = (spec: ViewSpec = {}): EngineView => viewAt(RACE(), 3, spec);

/** The job's output on `view`, as the worker computes it. */
const planned = (view: EngineView): StrategyOutput => runStrategy(structuredClone(prepareStrategy(view)), createRng(SEED));

type CarRows = Extract<StrategyOutput[CarId], { known: true }>['value'];

/** Car `car`'s entry; fails the test when it has none. */
function entryOf(out: StrategyOutput, car: CarId): CarRows {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

const saved = (slot: Slot, policy: Policy, carId: CarId = PLAYER) => ({ kind: 'planSaved' as const, carId, slot, policy });

/** The slots whose row is infeasible. */
const infeasibleOf = (rows: readonly McRow[]): Set<Slot> => new Set(rows.flatMap((r) => (r.slot !== null && r.infeasible !== null ? [r.slot] : [])));

/** A fresh (or `fitted`) set of `visualCompound`, as `./support.ts` builds them. */
const set = (visualCompound: 'soft' | 'medium' | 'hard', fitted = false): TyreSet => ({
  actualCompound: visualCompound === 'soft' ? 'C3' : visualCompound === 'medium' ? 'C2' : 'C1',
  visualCompound,
  wearPct: 0,
  available: true,
  fitted,
  recommendedSession: 0,
  lifeSpanLaps: 20,
  usableLifeLaps: 18,
  lapDeltaMs: 0,
});
/** On softs on the grid: the fitted soft, then a fresh soft, medium and hard. */
const SOFT_FITTED: readonly TyreSet[] = [set('soft', true), set('soft'), set('medium'), set('hard')];

/** Every final call's candidates of `car` (those of the calls that plan it). */
const candidatesIn = (car: CarId) => calls.list.filter((c) => plannedIn(c.input).includes(car)).map((c) => c.input.candidates[car] ?? []);

describe('the race\'s prefill on the grid (SP4.3d2 Task 9)', () => {
  it('3: race prefill: on grid with no slots → A = the best row, B by prefillOf; no planning', () => {
    const entry = entryOf(planned(onGrid()), PLAYER);
    expect(entry.rows.length).toBeGreaterThan(0);
    expect(entry.prefill.A, 'A: the best row').toEqual(entry.rows[0]!.policy);
    expect(entry.prefill).toEqual(prefillOf(entry.rows, entry.bestPerStops, {}, new Set()));
    expect(entry.planning, 'no planning round in the race').toBeNull();
  }, 60_000);

  it('3: race prefill: in the formation lap with no slots → prefill', () => {
    const entry = entryOf(planned(onGrid({}, 'formation')), PLAYER);
    expect(entry.prefill.A, 'A: the best row').toEqual(entry.rows[0]!.policy);
    expect(entry.prefill).toEqual(prefillOf(entry.rows, entry.bestPerStops, {}, new Set()));
  }, 60_000);

  it('3: race prefill: on racing → {}', () => {
    const entry = entryOf(planned(racing()), PLAYER);
    expect(entry.rows.length).toBeGreaterThan(0);
    expect(entry.prefill).toEqual({});
    expect(entry.planning).toBeNull();
  }, 60_000);

  it('3: race prefill: a saved A infeasible on grid → A prefilled', () => {
    const noHard = SETS.filter((s) => s.visualCompound !== 'hard');
    const onHard: Policy = { stops: [{ lap: 10, compound: 'hard' }] };
    const entry = entryOf(planned(onGrid({ sets: { [PLAYER]: noHard }, decisions: [saved('A', onHard)] })), PLAYER);
    const a = entry.rows.filter((r) => r.slot === 'A');
    expect(a, 'slot A is a row').toHaveLength(1);
    expect(a[0]!.infeasible, 'slot A: no hard set left').toBe('noSetLeft');
    expect(entry.prefill.A, 'A prefilled: the best row').toEqual(entry.rows[0]!.policy);
    expect(entry.prefill).toEqual(prefillOf(entry.rows, entry.bestPerStops, { A: onHard }, infeasibleOf(entry.rows)));
  }, 60_000);

  it('3: race prefill: a saved feasible A on grid → only B prefilled', () => {
    const a: Policy = { stops: [{ lap: 10, compound: 'hard' }] };
    const entry = entryOf(planned(onGrid({ decisions: [saved('A', a)] })), PLAYER);
    expect(entry.rows.find((r) => r.slot === 'A')?.infeasible).toBeNull();
    expect(entry.prefill.A, 'A saved: not prefilled').toBeUndefined();
    expect(entry.prefill).toEqual(prefillOf(entry.rows, entry.bestPerStops, { A: a }, new Set()));
  }, 60_000);
});

describe('the start compound on the race\'s grid (SP4.3d2 Task 9)', () => {
  const STOPS: Policy['stops'] = [{ lap: 10, compound: 'hard' }];
  const g1 = (startCompound: NoiseCompound): Policy => ({ startCompound, stops: STOPS });

  /** The G1 row and the G1 candidates of the final calls, on the grid with `sets` and G1 starting on `on`. */
  function g1On(on: NoiseCompound, sets: readonly TyreSet[]) {
    const entry = entryOf(planned(onGrid({ sets: { [PLAYER]: sets }, decisions: [saved('G1', g1(on))] })), PLAYER);
    const rows = entry.rows.filter((r) => r.slot === 'G1');
    expect(rows, 'G1 is still a row').toHaveLength(1);
    const cands = candidatesIn(PLAYER);
    expect(cands.length, "the player's calls").toBeGreaterThan(0);
    return { row: rows[0]!, candidates: cands.map((list) => list.filter((c) => c.slot === 'G1')) };
  }

  it('5: start compound: a G1 starting on W with no W set → infeasible startCompound, still a row, played with the fitted compound', () => {
    // the default sets: the fitted medium, a fresh soft, medium and hard; no wet set
    const { row, candidates } = g1On('wet', SETS);
    expect(row).toMatchObject({ source: 'game', infeasible: 'startCompound', policy: g1('wet') });
    for (const list of candidates) {
      expect(list).toHaveLength(1);
      expect([undefined, 'medium'], json(list[0]!.policy)).toContain(list[0]!.policy.startCompound);
      expect(list[0]!.policy.stops).toEqual(STOPS);
    }
  }, 60_000);

  it('5: start compound: a G1 starting on M with S fitted on the race\'s grid → infeasible startCompound, still a row, played on S', () => {
    const { row, candidates } = g1On('medium', SOFT_FITTED);
    expect(row).toMatchObject({ source: 'game', infeasible: 'startCompound', policy: g1('medium') });
    for (const list of candidates) {
      expect(list).toHaveLength(1);
      expect([undefined, 'soft'], json(list[0]!.policy)).toContain(list[0]!.policy.startCompound);
      expect(list[0]!.policy.stops).toEqual(STOPS);
    }
  }, 60_000);

  it('5: start compound: a G1 starting on the fitted S → feasible', () => {
    const { row } = g1On('soft', SOFT_FITTED);
    expect(row).toMatchObject({ source: 'game', infeasible: null, policy: g1('soft') });
  }, 60_000);
});
