import { describe, expect, it } from 'vitest';
import { createCalcStats } from '../../src/dev/calc-stats.ts';

/** A fake clock the test advances from inside the run, so each run lasts exactly the given ms. */
const setup = () => {
  let t = 1000;
  const stats = createCalcStats(() => t);
  const timed = (id: string, ms: number) => stats.hook(id, () => { t += ms; return ms; });
  return { stats, timed };
};

describe('createCalcStats', () => {
  it('the hook returns the value of the run and rethrows its exception', () => {
    const { stats } = setup();
    expect(stats.hook('a', () => 'value')).toBe('value');
    expect(() => stats.hook('a', () => { throw new Error('boom'); })).toThrow('boom');
  });

  it('keeps the mean over the last 100 runs: durations 1..150 ms give last 150, 150 runs, mean 100.5', () => {
    const { stats, timed } = setup();
    stats.atSessionTime(0);
    for (let ms = 1; ms <= 150; ms++) timed('a', ms);
    expect(stats.snapshot()).toEqual([{ id: 'a', lastMs: 150, runs: 150, meanMs: 100.5, lastSessionTime: 0 }]);
  });

  it('the mean of fewer than 100 runs is over all of them', () => {
    const { stats, timed } = setup();
    for (const ms of [2, 4, 6]) timed('a', ms);
    expect(stats.snapshot()[0]).toMatchObject({ lastMs: 6, runs: 3, meanMs: 4 });
  });

  it('lastSessionTime is the value atSessionTime set before the last run', () => {
    const { stats, timed } = setup();
    stats.atSessionTime(100);
    timed('a', 1);
    stats.atSessionTime(250);
    timed('a', 1);
    stats.atSessionTime(400);
    expect(stats.snapshot()[0]!.lastSessionTime).toBe(250);
  });

  it('two ids give two entries sorted by id, each with its own statistics', () => {
    const { stats, timed } = setup();
    timed('b', 10);
    timed('a', 2);
    timed('b', 20);
    expect(stats.snapshot()).toEqual([
      { id: 'a', lastMs: 2, runs: 1, meanMs: 2, lastSessionTime: expect.any(Number) },
      { id: 'b', lastMs: 20, runs: 2, meanMs: 15, lastSessionTime: expect.any(Number) },
    ]);
  });

  it('is empty before any run', () => {
    expect(setup().stats.snapshot()).toEqual([]);
  });
});
