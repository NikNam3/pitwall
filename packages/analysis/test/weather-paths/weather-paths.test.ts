// `weather-paths` (SP4.3c Task 14, O3b, spec §5.4a; C2, C50): the weather generator every planner uses, today's
// `race-monte-carlo` rain timeline moved unchanged. Row 1: for 10,000 seeded u per case the paths equal the ones
// today's `drawWeather` gave (`golden.json`, generated from it before the move; how the draws are read: `cases.ts`).
// Row 6: `weatherWorlds(start, k)`: u at the k midpoint quantiles, weight 1/k each; one world when every path is equal.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { known, unknown, type StartingPoint } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { weatherPath, weatherWorlds } from '../../src/weather-paths/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { CASES, DRAWS_PER_CASE, drawOf, pathText } from './cases.ts';

/** The interface's shapes (the plan's): a path lap and a world. */
type Lap = { lap: number; rain: boolean; wetnessMs: number };
type World = { u: number; weight: number; path: Float64Array };

type Golden = { cases: { name: string; sha256: string; rainLaps: number; samples: { id: number; u: number; shiftLaps: number; path: string }[] }[] };

const GOLDEN = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as Golden;

/** A three-car field on laps `lap` … `lapsTotal` with wetness `wetnessMs` and the forecast `pct` per lap (perfect). */
function withForecast(pct: (lap: number) => number, o: { lap?: number; lapsTotal?: number; wetnessMs?: number } = {}): StartingPoint {
  const s = startingPoint({ lap: o.lap ?? 4, lapsTotal: o.lapsTotal ?? 20, cars: [{}, {}, {}], ours: [0] });
  s.wetness = { wetnessMs: o.wetnessMs ?? 0, sdMs: 400 };
  s.weather = known({ byLap: Array.from({ length: s.lapsTotal }, (_, i) => ({ lap: i + 1, rainPct: pct(i + 1) })), accuracy: 'perfect' }, 0);
  return s;
}

describe('weather-paths: weatherPath is the Monte Carlo rain timeline, moved unchanged (row 1)', () => {
  for (const c of CASES) {
    it(`${c.name}: ${DRAWS_PER_CASE} seeded u give today's paths`, () => {
      const golden = GOLDEN.cases.find((g) => g.name === c.name);
      expect(golden, c.name).toBeDefined();
      const s = c.start();
      const texts: string[] = [];
      let rainLaps = 0;
      for (let id = 1; id <= DRAWS_PER_CASE; id++) {
        const { u, shiftLaps } = drawOf(c, s, id);
        const path = shiftLaps === 0 ? weatherPath(s, u) : weatherPath(s, u, shiftLaps);
        texts.push(pathText(path));
        rainLaps += path?.filter((w: Lap) => w.rain).length ?? 0;
      }
      for (const sample of golden!.samples) {
        expect(drawOf(c, s, sample.id)).toEqual({ u: sample.u, shiftLaps: sample.shiftLaps });
        expect(texts[sample.id - 1], `scenario ${sample.id}`).toBe(sample.path);
      }
      expect(rainLaps).toBe(golden!.rainLaps);
      expect(createHash('sha256').update(texts.join('\n')).digest('hex')).toBe(golden!.sha256);
    });
  }

  it('a perfect forecast reads no shift: the two-argument call equals a shift of 0', () => {
    const s = CASES[0]!.start();
    for (const u of [0, 0.05, 0.25, 0.5, 0.75, 0.999]) expect(weatherPath(s, u)).toStrictEqual(weatherPath(s, u, 0));
  });

  it('without a forecast there is no path (null: no rain model, C3)', () => {
    const s = withForecast(() => 50);
    s.weather = unknown('notReceived');
    expect(weatherPath(s, 0.1)).toBeNull();
  });

  it('is pure (C2): the same start and u give the same path, and the start is not changed', () => {
    const s = withForecast((l) => (l >= 8 ? 40 : 0), { wetnessMs: 3_000 });
    const before = JSON.stringify({ ...s, weather: s.weather, wetness: s.wetness });
    expect(weatherPath(s, 0.3)).toStrictEqual(weatherPath(s, 0.3));
    expect(JSON.stringify({ ...s, weather: s.weather, wetness: s.wetness })).toBe(before);
  });
});

describe('weather-paths: weatherWorlds, the DP worlds of the forecast (row 6, spec §5.4a)', () => {
  it('no rain chance: weatherWorlds(start, 2) is one world of weight 1, the path of any u', () => {
    for (const wetnessMs of [0, 9_000]) {
      const s = withForecast(() => 0, { wetnessMs });
      const worlds = weatherWorlds(s, 2);
      expect(worlds, `wetness ${wetnessMs}`).toHaveLength(1);
      expect(worlds[0]!.weight).toBe(1);
      const path = weatherPath(s, 0.25)!;
      expect([...worlds[0]!.path]).toEqual(path.map((w: Lap) => w.wetnessMs));
      expect([...worlds[0]!.path]).toEqual(weatherPath(s, 0.75)!.map((w: Lap) => w.wetnessMs));
    }
  });

  it('a rain chance between the quantiles: two worlds at u 0.25 and 0.75, weight 1/2 each, each its weatherPath', () => {
    // 50 % from lap 10: u 0.25 rains from lap 10, u 0.75 stays dry
    const s = withForecast((l) => (l >= 10 ? 50 : 0));
    const worlds = weatherWorlds(s, 2);
    expect(worlds.map((w: World) => [w.u, w.weight])).toEqual([
      [0.25, 0.5],
      [0.75, 0.5],
    ]);
    for (const w of worlds as World[]) {
      expect(w.path).toBeInstanceOf(Float64Array);
      expect([...w.path]).toEqual(weatherPath(s, w.u)!.map((l: Lap) => l.wetnessMs));
    }
    expect([...worlds[0]!.path].some((x) => x > 0)).toBe(true);
    expect([...worlds[1]!.path].every((x) => x === 0)).toBe(true);
  });

  it('k worlds at the k midpoint quantiles (u = (i + 0.5) / k), weights summing to 1', () => {
    const s = withForecast((l) => (l >= 6 ? 5 * (l - 5) : 0));
    const worlds = weatherWorlds(s, 4);
    expect(worlds.map((w: World) => w.u)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(worlds.map((w: World) => w.weight)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
