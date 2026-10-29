// Band alarms on real recordings: brake and tyre temperatures swing within every lap, so no band alarm may raise and
// resolve within one lap (B3: the alarm list flashed "FL brake below band" on and off all lap on ttZandvoort).
import { expect, it } from 'vitest';
import type { InsightEntry } from '@pitwall/contracts';
import type { LapRecord } from '@pitwall/domain';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayTopics } from './replay-topics.ts';

const SUBS = [
  ['insights', 'insights', {}],
  ['laps', 'laps', {}],
] as const;
const BAND_KINDS = new Set(['bandOut', 'bandOutLap']);

/**
 * Raise and resolve transitions of every band alarm key, bucketed by the lap of its car the transition happened in
 * (bucket n: after n completed laps). Returns the buckets with more than one transition, as `key lap n: count`.
 */
async function flickers(path: string): Promise<string[]> {
  const r = await replayTopics(path, SUBS);
  expect(r.errors).toEqual([]);
  const completions = new Map<number, Map<number, number>>(); // car -> lap number -> completedAt
  for (const l of r.entries('laps') as LapRecord[]) (completions.get(l.carId) ?? completions.set(l.carId, new Map()).get(l.carId)!).set(l.lapNumber, l.completedAt);
  const lapOf = (car: number, at: number) => [...(completions.get(car)?.values() ?? [])].filter((t) => t <= at).length;
  const carOfKey = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const e of r.entries('insights') as InsightEntry[]) {
    const key = e.type === 'raised' ? e.insight.key : e.key;
    if (e.type === 'raised') {
      if (!BAND_KINDS.has(e.insight.kind) || e.insight.carId === undefined) continue;
      carOfKey.set(key, e.insight.carId);
    }
    const car = carOfKey.get(key);
    if (car === undefined) continue;
    const at = e.type === 'raised' ? e.insight.raisedAt : e.at;
    const bucket = `${key} lap ${lapOf(car, at) + 1}`;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([b, n]) => `${b}: ${n}`);
}

describeWithFixture('ttZandvoort', 'acceptance: band alarms on TT Zandvoort', (path) => {
  it('no band alarm raises and resolves within one lap', async () => {
    expect(await flickers(path)).toEqual([]);
  });
});

describeWithFixture('raceSingapore', 'acceptance: band alarms on race Singapore', (path) => {
  it('no band alarm raises and resolves within one lap', async () => {
    expect(await flickers(path)).toEqual([]);
  });
});
