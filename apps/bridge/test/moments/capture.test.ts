// Named moments (spec 9.1, Task 21). Contract assumed of `captureMoment(segmentPath, atMs)`:
//  - `atMs` is the receive-time offset from the segment's first record; records at or before it are processed;
//  - the result is `Array<{ topic, params, value?, entries? }>`: every feed topic with `{}` params and the per-car
//    topics (`car.detail`, `car.telemetry`) with `{ carId }` for every active car;
//  - append topics (`laps`) carry `entries`, state topics carry `value`;
//  - deterministic: two runs give byte-identical JSON.
import { describe, expect, it } from 'vitest';
import { captureMoment, type MomentValues } from '../../src/moments/capture.ts';
import { offsets, readMomentsFile, segmentPath } from './helpers.ts';

const find = (values: MomentValues, topic: string, params: object = {}) =>
  values.find((v) => v.topic === topic && JSON.stringify(v.params) === JSON.stringify(params));

describe('captureMoment', () => {
  it('twice gives byte-identical JSON', async () => {
    const path = segmentPath('tt-zandvoort-lap1.pwrec.gz');
    const a = await captureMoment(path, 3000);
    const b = await captureMoment(path, 3000);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 60_000);

  it('holds the feed topics with {} params and the per-car topics for the active car', async () => {
    const values = await captureMoment(segmentPath('tt-zandvoort-lap1.pwrec.gz'), 3000);
    expect(find(values, 'session.info')?.value).toBeDefined();
    expect(find(values, 'feed.status')?.value).toBeDefined();
    expect(find(values, 'car.detail', { carId: 0 })?.value).toBeDefined();
    expect(find(values, 'car.telemetry', { carId: 0 })?.value).toBeDefined();
    expect(find(values, 'car.detail', { carId: 1 })).toBeUndefined();
  }, 60_000);

  it('includes the per-car topics of every active car (Singapore grid: 20)', async () => {
    const { endMs } = await offsets('race-singapore-start.pwrec.gz', 'LGOT');
    const values = await captureMoment(segmentPath('race-singapore-start.pwrec.gz'), endMs);
    const cars = values.filter((v) => v.topic === 'car.detail').map((v) => (v.params as { carId: number }).carId);
    expect([...cars].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  }, 60_000);

  it('stops at atMs: an earlier moment holds fewer laps than a later one', async () => {
    const path = segmentPath('tt-zandvoort-lap1.pwrec.gz');
    const early = await captureMoment(path, 1000);
    const late = await captureMoment(path, 5900);
    expect(find(early, 'laps')?.entries ?? []).toHaveLength(0);
    expect((find(late, 'laps')?.entries ?? []).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('fixtures/moments.json', () => {
  it('names the three moments with their segments', () => {
    const moments = readMomentsFile();
    expect(Object.keys(moments).sort()).toEqual(['raceSingaporeEnd.chequered', 'raceSingaporeStart.grid', 'ttZandvoortLap1.crossing']);
    expect(moments['ttZandvoortLap1.crossing']!.segment).toBe('tt-zandvoort-lap1.pwrec.gz');
    expect(moments['raceSingaporeStart.grid']!.segment).toBe('race-singapore-start.pwrec.gz');
    expect(moments['raceSingaporeEnd.chequered']!.segment).toBe('race-singapore-end.pwrec.gz');
  });

  it('puts ttZandvoortLap1.crossing at the FTLP (within 1 s after it)', async () => {
    const at = readMomentsFile()['ttZandvoortLap1.crossing']!.atMs;
    const { eventMs } = await offsets('tt-zandvoort-lap1.pwrec.gz', 'FTLP');
    expect(eventMs).toBeDefined();
    expect(at).toBeGreaterThanOrEqual(eventMs!);
    expect(at).toBeLessThanOrEqual(eventMs! + 1000);
  });

  it('puts raceSingaporeStart.grid at the end of its segment and raceSingaporeEnd.chequered after SEND', async () => {
    const moments = readMomentsFile();
    const start = await offsets('race-singapore-start.pwrec.gz', 'SSTA');
    expect(moments['raceSingaporeStart.grid']!.atMs).toBeGreaterThanOrEqual(start.endMs - 1);
    const end = await offsets('race-singapore-end.pwrec.gz', 'SEND');
    expect(end.eventMs).toBeDefined();
    expect(moments['raceSingaporeEnd.chequered']!.atMs).toBeGreaterThanOrEqual(end.eventMs!);
  });

  it('ttZandvoortLap1.crossing holds a laps entry for lap 1 of car 0 with 71 910 ms', async () => {
    const { segment, atMs } = readMomentsFile()['ttZandvoortLap1.crossing']!;
    const values = await captureMoment(segmentPath(segment), atMs);
    const laps = find(values, 'laps');
    expect(laps?.entries).toBeDefined();
    expect(laps!.entries).toContainEqual(expect.objectContaining({ carId: 0, lapNumber: 1, lapTimeMs: 71910 }));
  }, 60_000);
});
