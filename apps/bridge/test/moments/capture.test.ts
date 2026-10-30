// Named moments (spec 9.1, Task 21). Contract assumed of `captureMoment(segmentPath, atMs)`:
//  - `atMs` is the receive-time offset from the segment's first record; records at or before it are processed;
//  - the result is `Array<{ topic, params, value?, entries? }>`: every feed topic without params with `{}`, and every
//    feed topic with params once per params its `momentParams` gives for the active cars (`car.detail` `active`), in
//    that order (Task M); job topics stay out; a state topic without a value is left out;
//  - append topics (`laps`) carry `entries`, state topics carry `value`;
//  - deterministic: two runs give byte-identical JSON.
import { existsSync } from 'node:fs';
import { TOPICS, type SessionInfo, type TopicName } from '@pitwall/contracts';
import { carId, MAX_CARS, type CarId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../../src/features/index.generated.ts';
import { captureMoment, type MomentValues } from '../../src/moments/capture.ts';
import { offsets, readMomentsFile, segmentPath } from './helpers.ts';

const find = (values: MomentValues, topic: string, params: object = {}) =>
  values.find((v) => v.topic === topic && JSON.stringify(v.params) === JSON.stringify(params));

const LAP10 = 'race-zandvoort-lap10.pwrec.gz';
/** The `raceZandvoortLap10.crossing` moment: just after the player's line crossing. */
const CROSSING_MS = 3200;

/** JSON with sorted object keys, so equal params give equal text. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

const JOB_TOPICS = new Set<string>(FEATURES.flatMap((f) => f.topics.flatMap((b) => ('fromJob' in b ? [b.topic] : []))));

/** The feed topics a moment captures with params, with their `momentParams`, from the contracts alone. */
const PARAM_TOPICS = (Object.keys(TOPICS) as TopicName[]).flatMap((topic) => {
  const def = TOPICS[topic] as { scope: string; momentParams?: (carIds: readonly CarId[]) => object[] };
  return def.scope === 'feed' && !JOB_TOPICS.has(topic) && def.momentParams !== undefined ? [{ topic, momentParams: def.momentParams }] : [];
});

const activeCars = (values: MomentValues): CarId[] =>
  values.flatMap((v) => (v.topic === 'car.detail' && (v.value as { active?: boolean } | undefined)?.active === true ? [(v.params as { carId: CarId }).carId] : []));

const paramsOf = (values: MomentValues, topic: string): string[] => values.filter((v) => v.topic === topic).map((v) => canonical(v.params));

describe('captureMoment', () => {
  it('twice gives byte-identical JSON', async () => {
    const path = segmentPath(LAP10);
    const a = await captureMoment(path, 3000);
    const b = await captureMoment(path, 3000);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 60_000);

  it('holds the feed topics with {} params and the per-car topics of the active cars only', async () => {
    const values = await captureMoment(segmentPath(LAP10), 3000);
    expect(find(values, 'session.info')?.value).toBeDefined();
    expect(find(values, 'feed.status')?.value).toBeDefined();
    expect(find(values, 'car.detail', { carId: 1 })?.value).toBeDefined();
    expect(find(values, 'car.telemetry', { carId: 1 })?.value).toBeDefined();
    expect(find(values, 'car.detail', { carId: 20 })).toBeUndefined();
  }, 60_000);

  it('includes the per-car topics of every active car (Singapore grid: 20)', async () => {
    const { endMs } = await offsets('race-singapore-start.pwrec.gz', 'LGOT');
    const values = await captureMoment(segmentPath('race-singapore-start.pwrec.gz'), endMs);
    const cars = values.filter((v) => v.topic === 'car.detail').map((v) => (v.params as { carId: number }).carId);
    expect([...cars].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  }, 60_000);

  it('holds every feed topic with params, only with the params its momentParams gives for the active cars, in that order', async () => {
    const values = await captureMoment(segmentPath(LAP10), CROSSING_MS);
    const active = activeCars(values);
    expect(active.length).toBeGreaterThan(0);
    expect(PARAM_TOPICS.length).toBeGreaterThan(2);
    for (const { topic, momentParams } of PARAM_TOPICS) {
      const expected = momentParams(active).map(canonical);
      const got = paramsOf(values, topic);
      expect(got.length, topic).toBeGreaterThan(0);
      // a state topic without a value is left out, so the moment holds an ordered part of the expected params
      expect(expected.filter((p) => got.includes(p)), topic).toEqual(got);
    }
  }, 60_000);

  it('holds a value for the per-car topics of the player car', async () => {
    const values = await captureMoment(segmentPath(LAP10), CROSSING_MS);
    const player = (find(values, 'session.info')?.value as SessionInfo | undefined)?.playerCar;
    expect(player).toBeDefined();
    for (const topic of ['fuel.car', 'ers.car', 'tyreWear.car', 'lapTimes.projection']) {
      expect(find(values, topic, { carId: player })?.value, topic).toBeDefined();
    }
  }, 60_000);

  it("never holds an inactive car's params", async () => {
    const values = await captureMoment(segmentPath(LAP10), CROSSING_MS);
    const active = activeCars(values);
    const inactive = Array.from({ length: MAX_CARS }, (_, i) => carId(i)).filter((id) => !active.includes(id));
    expect(inactive.length).toBeGreaterThan(0);
    for (const { topic, momentParams } of PARAM_TOPICS) {
      const allowed = new Set(momentParams(active).map(canonical));
      const inactiveOnly = momentParams(inactive).map(canonical).filter((p) => !allowed.has(p));
      expect(inactiveOnly.length, topic).toBeGreaterThan(0);
      for (const p of inactiveOnly) expect(paramsOf(values, topic), topic).not.toContain(p);
    }
  }, 60_000);

  it('stops at atMs: an earlier moment holds fewer laps than a later one', async () => {
    const path = segmentPath(LAP10);
    const early = await captureMoment(path, 1000);
    const late = await captureMoment(path, 4900);
    expect(find(early, 'laps')?.entries ?? []).toHaveLength(0);
    expect((find(late, 'laps')?.entries ?? []).length).toBeGreaterThan(0);
  }, 60_000);

  it('a moment just after a line crossing holds the laps entry of the lap completed there (car 1, lap 9, 74 655 ms)', async () => {
    const { eventMs } = await offsets(LAP10, 'FTLP');
    expect(eventMs).toBeDefined();
    const values = await captureMoment(segmentPath(LAP10), eventMs! + 1000);
    expect(find(values, 'laps')?.entries).toContainEqual(expect.objectContaining({ carId: 1, lapNumber: 9, lapTimeMs: 74_655 }));
  }, 60_000);
});

describe('fixtures/moments.json', () => {
  it('names the race moments with their segments, and the segment of every moment exists', () => {
    const moments = readMomentsFile();
    expect(moments['raceSingaporeStart.grid']!.segment).toBe('race-singapore-start.pwrec.gz');
    expect(moments['raceSingaporeEnd.chequered']!.segment).toBe('race-singapore-end.pwrec.gz');
    for (const [name, { segment }] of Object.entries(moments)) expect(existsSync(segmentPath(segment)), name).toBe(true);
  });

  it('puts raceSingaporeStart.grid at the end of its segment and raceSingaporeEnd.chequered after SEND', async () => {
    const moments = readMomentsFile();
    const start = await offsets('race-singapore-start.pwrec.gz', 'SSTA');
    expect(moments['raceSingaporeStart.grid']!.atMs).toBeGreaterThanOrEqual(start.endMs - 1);
    const end = await offsets('race-singapore-end.pwrec.gz', 'SEND');
    expect(end.eventMs).toBeDefined();
    expect(moments['raceSingaporeEnd.chequered']!.atMs).toBeGreaterThanOrEqual(end.eventMs!);
  });
});
