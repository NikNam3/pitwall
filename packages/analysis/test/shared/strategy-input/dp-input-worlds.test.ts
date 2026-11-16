// SP4.3c Task 19 (B5, O1, O3b; C43, C47, C50): the DP's input per car carries the weather worlds of `weather-paths`
// (`weatherWorlds(field, worlds)`, `worlds` from `strategy-dp`'s config, default 2): each world's `u`, weight and wetness
// per lap from the car's `fromLap` (the path of `weatherWorlds`, index 0 at `start.lap`), and its own traffic; the
// constant fill of today's wetness on every lap is gone. Each compound carries its own tyre terms from
// `StartingPoint.tyre` (`tyreIndex(car, compound)`), and its laps to the 70 % limit (`-1`: none known → `null`), the
// fitted set its own (`StartingPoint.fittedLapsToLimit`).
import { carId, known, NOISE_COMPOUNDS, tyreIndex, unknown, type StartingPoint } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { startLapOf } from '../../../src/race-forecast/index.ts';
import { toDpInput, type StrategyInput } from '../../../src/shared/strategy-input/index.ts';
import { STRATEGY_DP_CONFIG } from '../../../src/strategy-dp/config.ts';
import { weatherWorlds } from '../../../src/weather-paths/index.ts';
import { startingPoint } from '../../race-forecast/start.ts';

/** Our car leads (so it plans from the leader's lap, `start.lap`). */
const CAR = carId(0);
const LAP = 5;
const LAPS = 30;

/** Three cars, ours in front with per-compound tyre terms; the forecast's chance `rainPct(lap)` when given. */
function field(rainPct?: (lap: number) => number): StartingPoint {
  const start = startingPoint({
    lap: LAP,
    lapsTotal: LAPS,
    ours: [CAR],
    cars: [
      {
        gapMs: 0,
        compound: 'medium',
        tyre: { soft: { wearRatePct: 3, degMsPerLap: 40, lapsToLimit: 23 }, medium: { wearRatePct: 2, degMsPerLap: 25, lapsToLimit: 35 }, hard: { wearRatePct: 1.2, degMsPerLap: 12 } },
        fittedLapsToLimit: 9,
      },
      { gapMs: 2_000 },
      { gapMs: 4_000 },
    ],
  });
  if (rainPct === undefined) return start;
  const byLap = Array.from({ length: LAPS - LAP + 1 }, (_, i) => ({ lap: LAP + i, rainPct: rainPct(LAP + i) }));
  return { ...start, weather: known({ byLap, accuracy: 'perfect' as const }, 0), wetness: { wetnessMs: 0, sdMs: 0, wet: false } };
}

const inputOf = (start: StartingPoint, config: StrategyInput['config'] = {}): StrategyInput => ({
  start: known(start, 0),
  hazard: unknown('notReceived'),
  ourCars: [CAR],
  planned: [CAR],
  committed: { [CAR]: null },
  positions: { [CAR]: 1 },
  config,
});

/** Rain likely on laps up to 15 (70 %), unlikely after (10 %): the worlds at u 0.25 and 0.75 differ. */
const SHOWER = (lap: number): number => (lap <= 15 ? 70 : 10);

describe("the DP input's weather worlds (SP4.3c Task 19, B5, O3b)", () => {
  it("strategy-dp's config declares worlds, 2 by default (C47)", () => {
    expect(STRATEGY_DP_CONFIG.key).toBe('strategy-dp');
    expect(STRATEGY_DP_CONFIG.defaults.worlds).toBe(2);
  });

  it("with rain forecast: weatherWorlds' worlds, each its own wetness per lap from fromLap (no constant fill)", () => {
    const start = field(SHOWER);
    const expected = weatherWorlds(start, 2);
    expect(expected, 'the case: two different worlds').toHaveLength(2);
    const dp = toDpInput(inputOf(start), CAR);
    const fromLap = startLapOf(start, CAR);
    const n = LAPS - fromLap + 1;
    expect(dp.fromLap).toBe(fromLap);
    expect(dp.worlds.map((w) => ({ u: w.u, weight: w.weight }))).toEqual(expected.map((w) => ({ u: w.u, weight: w.weight })));
    dp.worlds.forEach((w, k) => {
      expect(Array.from(w.wetnessByLap), `world ${k}: its path from fromLap`).toEqual(Array.from({ length: n }, (_, i) => expected[k]!.path[fromLap + i - start.lap]));
      expect(w.trafficMsByLap, `world ${k}: its own traffic per lap`).toHaveLength(n);
    });
    // the worlds differ: the wet-leaning one is wet where the dry-leaning one is not
    expect(Array.from(dp.worlds[0]!.wetnessByLap)).not.toEqual(Array.from(dp.worlds[1]!.wetnessByLap));
    expect(new Set(Array.from(dp.worlds[0]!.wetnessByLap)).size, 'not one constant wetness').toBeGreaterThan(1);
  });

  it('no rain chance (or no forecast): one world of weight 1 at the current wetness, so one solve', () => {
    for (const [what, start] of [
      ['no forecast', field()],
      ['a forecast without rain', field(() => 0)],
    ] as const) {
      const dp = toDpInput(inputOf(start), CAR);
      expect(dp.worlds, what).toHaveLength(1);
      expect(dp.worlds[0]!.weight, what).toBe(1);
      expect(Array.from(dp.worlds[0]!.wetnessByLap).every((w) => w === start.wetness.wetnessMs), what).toBe(true);
    }
  });

  it("the run's config sets the number of worlds (C47)", () => {
    const start = field(SHOWER);
    const dp = toDpInput(inputOf(start, { [STRATEGY_DP_CONFIG.key]: { worlds: 4 } }), CAR);
    expect(dp.worlds.map((w) => w.u)).toEqual(weatherWorlds(start, 4).map((w) => w.u));
    expect(dp.worlds).toHaveLength(4);
  });
});

describe("the DP input's tyre terms per compound and the 70 % limit (SP4.3c Task 19, O1, §5.2)", () => {
  it("each compound its own wear rate and ν from StartingPoint.tyre; its laps to the limit; the fitted set's own", () => {
    const start = field();
    const dp = toDpInput(inputOf(start), CAR);
    NOISE_COMPOUNDS.forEach((c, i) => {
      const t = tyreIndex(CAR, i);
      expect(dp.carParams.wearRatePct?.[c], `${c}: wear rate`).toBe(start.tyre.wearRatePct[t]);
      expect(dp.carParams.degMsPerLap[c], `${c}: ν`).toBe(start.tyre.degMsPerLap[t]);
      const limit = start.tyre.lapsToLimit[t]!;
      expect(dp.carParams.lapsToLimit[c], `${c}: laps to the limit`).toBe(limit < 0 ? null : limit);
    });
    expect(dp.carParams.degMsPerLap).toMatchObject({ soft: 40, medium: 25, hard: 12 });
    expect(dp.carParams.lapsToLimit).toMatchObject({ soft: 23, medium: 35, hard: null });
    expect(dp.carParams.fittedLapsToLimit).toBe(9);
  });

  it('a set at or past the limit: laps to it 0; none known: null', () => {
    const start = field();
    start.fittedLapsToLimit[CAR] = 0;
    expect(toDpInput(inputOf(start), CAR).carParams.fittedLapsToLimit).toBe(0);
    start.fittedLapsToLimit[CAR] = -1;
    expect(toDpInput(inputOf(start), CAR).carParams.fittedLapsToLimit).toBeNull();
  });
});
