// `forecast-score`'s CRPS (SP4.3b spec §8.4; SP4.3b1 plan Task 22 rows 1–3; C45, C47, C51): per horizon (and basis,
// like the other forecast tables), AI and human apart, the mean ranked probability score of `race-monte-carlo`'s
// `fieldPositions` position pmf against the place the car had. One run per predict lap (every `crpsEveryLaps` from lap
// 2) over the plain plans, `crpsScenarios` scenarios, a zero hazard, the rivals' rule from `strategy`'s config; the
// cases are the forecast cases (F1: no SC/VSC lap in the horizon; no own stop in it) at the predict laps.
import { currentLaps, type ForecastScoreReport, type LapRecord, type ScoreTable } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rankedProbabilityScore } from '../../src/forecast-score/crps.ts';
import { forecastCases, type ForecastCase, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { run, type ScoreInput } from '../../src/forecast-score/job.ts';
import type * as fieldModule from '../../src/race-monte-carlo/field.ts';
import { fieldPositions } from '../../src/race-monte-carlo/field.ts';
import type { FieldInput, FieldResult } from '../../src/race-monte-carlo/types.ts';
import { generated, inputAt, SMALL } from './support.ts';

// Every `fieldPositions` run of the job, through to the real simulator.
vi.mock('../../src/race-monte-carlo/field.ts', async (original) => {
  const m = await original<typeof fieldModule>();
  return { ...m, fieldPositions: vi.fn(m.fieldPositions) };
});
const field = vi.mocked(fieldPositions);
beforeEach(() => {
  field.mockClear();
});

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];
const HUMANS = new Set([6, 7]);
/** A scenario count other than the default 200, so the test sees it comes from the config (C47). */
const SCENARIOS = 60;
/** `strategy`'s rivals' rule, other than its defaults, so the test sees the job reads it through `view.config`. */
const RIVALS = { rivalScBoxChance: 0.5, rivalScMinTyreAge: 7, rivalReactionLaps: 2 };

/** `ForecastScoreReport.forecasts[].crps` (a domain type the supervisor adds, C78): per driver type, n and the mean. */
type Summary = ScoreTable['ai'];
type Crps = { ai: Summary; human: Summary };
const crpsOf = (f: ForecastScoreReport['forecasts'][number]): Crps | undefined => (f as unknown as { crps?: Crps }).crps;

/** `input` with `forecast-score`'s CRPS scenario count and `strategy`'s rivals' rule set. */
const configured = (input: ScoreInput): ScoreInput => ({
  ...input,
  config: { ...input.config, 'forecast-score': { ...input.config['forecast-score'], crpsScenarios: SCENARIOS }, strategy: { ...input.config['strategy'], ...RIVALS } },
});

/** The predict lap of a `fieldPositions` run: its first lap is predict lap + 1 (horizon 1). */
const predictLapOf = (call: FieldInput) => Math.min(...call.laps) - 1;

/** The CRPS cases of `input`: the forecast cases from leader lap 2 at the predict laps 2, 7, 12, … */
const crpsCases = (input: ScoreInput): ForecastCase[] => forecastCases(input.history, HORIZONS, 2).filter((c) => (c.lap - 2) % 5 === 0);

describe('forecast-score CRPS', () => {
  it('the score of a point mass at the true place is 0; of half at the true place and half one place off, 0.25', () => {
    expect(rankedProbabilityScore([0, 1, 0, 0], 2)).toBe(0);
    expect(rankedProbabilityScore([1, 0, 0], 1)).toBe(0);
    expect(rankedProbabilityScore([0, 0, 0, 1], 4)).toBe(0);
    // half at P2 (true), half at P3: the cumulative distributions differ by 0.5 at P2 only
    expect(rankedProbabilityScore([0, 0.5, 0.5, 0], 2)).toBeCloseTo(0.25, 12);
    // half at P1, half at P2 (true): they differ by 0.5 at P1 only
    expect(rankedProbabilityScore([0.5, 0.5, 0, 0], 2)).toBeCloseTo(0.25, 12);
    // a point mass two places off: 1 at each of the two places between
    expect(rankedProbabilityScore([1, 0, 0, 0], 3)).toBeCloseTo(2, 12);
  });

  it('one Monte Carlo run per predict lap, every 5 laps from lap 2, serves every car and horizon', () => {
    // The small generator race: 8 cars (6 and 7 human), 20 laps, every car one green stop on laps 8 to 10.
    const input = configured(inputAt(generated()));
    const report = run(input, createRng(0));
    const calls = field.mock.calls.map(([call]) => call);
    const results = field.mock.results.map((r) => r.value as FieldResult);

    // One run per predict lap: leader laps 2, 7, 12 and 17, no other.
    expect(calls.map(predictLapOf).sort((a, b) => a - b)).toEqual([2, 7, 12, 17]);
    for (const call of calls) {
      const lap = predictLapOf(call);
      // at the laps predict lap + each horizon, over every car's plain plan, with the configured scenarios and rivals' rule
      for (const l of call.laps) expect(HORIZONS.map((h) => lap + h), `predict lap ${lap}`).toContain(l);
      expect(call.scenarios).toBe(SCENARIOS);
      expect(Object.keys(call.plans)).toHaveLength(SMALL.cars);
      expect(call.rivalRules).toMatchObject({ q: RIVALS.rivalScBoxChance, aMin: RIVALS.rivalScMinTyreAge, reactionLaps: RIVALS.rivalReactionLaps });
    }

    // Every case's CRPS comes from its predict lap's one run: the car's pmf at its target lap against its place.
    const cases = crpsCases(input);
    expect(cases.length).toBeGreaterThan(0);
    const byLap = new Map(calls.map((call, i) => [predictLapOf(call), { call, result: results[i]! }]));
    const scoreOf = (c: ForecastCase): number => {
      const r = byLap.get(c.lap);
      expect(r, `run at predict lap ${c.lap}`).toBeDefined();
      const j = r!.call.laps.indexOf(c.targetLap);
      expect(j, `car ${c.carId} lap ${c.lap} h${c.horizon}`).toBeGreaterThanOrEqual(0);
      const pmf = r!.result.positionPmf[c.carId]![j]!;
      return rankedProbabilityScore(pmf, c.actualPosition);
    };
    let tables = 0;
    for (const f of report.forecasts) {
      const crps = crpsOf(f);
      expect(crps, `h${f.horizon} ${f.basis}`).toBeDefined();
      for (const driver of ['ai', 'human'] as const) {
        const of = cases.filter((c) => c.horizon === f.horizon && c.basis === f.basis && HUMANS.has(c.carId) === (driver === 'human'));
        const summary = crps![driver];
        expect(summary.n, `h${f.horizon} ${f.basis} ${driver}`).toBe(of.length);
        if (of.length === 0) {
          expect(summary.meanAbs.known).toBe(false);
          continue;
        }
        tables += 1;
        const mean = of.reduce((s, c) => s + scoreOf(c), 0) / of.length;
        expect(summary.meanAbs.known, `h${f.horizon} ${f.basis} ${driver}`).toBe(true);
        if (summary.meanAbs.known) expect(summary.meanAbs.value, `h${f.horizon} ${f.basis} ${driver}`).toBeCloseTo(mean, 9);
      }
    }
    // AI and human, several horizons
    expect(tables).toBeGreaterThanOrEqual(4);
  });

  it('cases with SC/VSC laps in the horizon have no CRPS, and the run draws no neutralisation', () => {
    // The small race with a safety car on laps 9 and 10.
    const input = configured(inputAt(generated({ ...SMALL, sc: { fromLap: 9, toLap: 10 } })));
    const neutral = new Set(
      currentLaps(input.history.laps as readonly LapRecord[])
        .filter((l) => l.status === 'confirmed' && l.scShare + l.vscShare > 0)
        .map((l) => `${l.carId}:${l.lapNumber}`),
    );
    expect(neutral.size).toBeGreaterThan(0);
    const report = run(input, createRng(0));

    // The CRPS cases are those whose horizon holds no lap of the car with an SC or VSC share…
    const cases = crpsCases(input);
    for (const c of cases) for (let n = c.lap + 1; n <= c.targetLap; n++) expect(neutral.has(`${c.carId}:${n}`)).toBe(false);
    // …and some horizon of a predict lap holds an SC lap of its car (from lap 7, h3 reaches lap 9), so F1 left it out
    const laps = new Set(currentLaps(input.history.laps as readonly LapRecord[]).filter((l) => l.status === 'confirmed').map((l) => `${l.carId}:${l.lapNumber}`));
    let left = 0;
    for (const lap of [2, 7, 12, 17]) {
      for (const h of HORIZONS) {
        for (let car = 0; car < SMALL.cars; car++) {
          if (!laps.has(`${car}:${lap}`) || !laps.has(`${car}:${lap + h}`)) continue;
          let sc = false;
          for (let k = lap + 1; k <= lap + h; k++) sc ||= neutral.has(`${car}:${k}`);
          if (sc) left += 1;
        }
      }
    }
    expect(left).toBeGreaterThan(0);
    let n = 0;
    for (const f of report.forecasts) {
      const crps = crpsOf(f);
      expect(crps, `h${f.horizon} ${f.basis}`).toBeDefined();
      const of = cases.filter((c) => c.horizon === f.horizon && c.basis === f.basis);
      expect(crps!.ai.n + crps!.human.n, `h${f.horizon} ${f.basis}`).toBe(of.length);
      n += crps!.ai.n + crps!.human.n;
    }
    expect(n).toBeGreaterThan(0);

    // Every run draws no neutralisation: a zero SC and VSC hazard on every lap, no neutralisation active.
    expect(field).toHaveBeenCalled();
    for (const [call] of field.mock.calls) {
      expect([...call.hazard.byLap].every((p) => p === 0), `predict lap ${predictLapOf(call)}: SC hazard`).toBe(true);
      expect([...call.hazard.vscByLap].every((p) => p === 0), `predict lap ${predictLapOf(call)}: VSC hazard`).toBe(true);
      expect(call.hazard.active).toBeNull();
    }
  });
});
