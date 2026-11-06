// Named moments (spec 9.1, Task 21). Contract assumed of `captureMoment(segmentPath, atMs)`:
//  - `atMs` is the receive-time offset from the segment's first record; records at or before it are processed;
//  - the result is `Array<{ topic, params, value?, entries? }>`: every feed topic without params with `{}`, and every
//    feed topic with params once per params its `momentParams` gives for the active cars (the cars in the session:
//    car-status's open spans not `absent`, Task 24), in that order (Task M); job topics stay out; a state topic without a
//    value is left out;
//  - append topics (`laps`) carry `entries`, state topics carry `value`;
//  - deterministic: two runs give byte-identical JSON.
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, TOPICS, type MachineSpans, type SessionInfo, type TopicName } from '@pitwall/contracts';
import { carId, known, MAX_CARS, type CalibrationActiveValue, type CarId, type PriorsSnapshot } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../../src/features/index.generated.ts';
import { captureMoment, type MomentValues } from '../../src/moments/capture.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { offsets, readMomentsFile, segmentPath } from './helpers.ts';
import { NOT_YET_BOUND } from '../helpers/not-yet-bound.ts';

const find = (values: MomentValues, topic: string, params: object = {}) =>
  values.find((v) => v.topic === topic && JSON.stringify(v.params) === JSON.stringify(params));

const LAP10 = 'race-zandvoort-lap10.pwrec.gz';
/** The `raceZandvoortLap10.crossing` moment: just after the player's line crossing. */
const CROSSING_MS = 3200;

const JOB_TOPICS = new Set<string>(FEATURES.flatMap((f) => f.topics.flatMap((b) => ('fromJob' in b ? [b.topic] : []))));

/** The feed topics a moment captures with params, with their `momentParams`, from the contracts alone. */
const PARAM_TOPICS = (Object.keys(TOPICS) as TopicName[]).flatMap((topic) => {
  const def = TOPICS[topic] as { scope: string; momentParams?: (carIds: readonly CarId[]) => object[] };
  return def.scope === 'feed' && !JOB_TOPICS.has(topic) && !NOT_YET_BOUND.has(topic) && def.momentParams !== undefined ? [{ topic, momentParams: def.momentParams }] : [];
});

/** The cars in the session at the moment: the car-status spans open and not `absent` (C43; Task 24: no `car.active`). */
const activeCars = (values: MomentValues): CarId[] =>
  ((find(values, 'situation.carStatus')?.value as MachineSpans | undefined)?.open ?? [])
    .flatMap((s) => (s.kind !== 'absent' && s.carId !== undefined ? [s.carId] : []))
    .sort((a, b) => a - b);

const paramsOf = (values: MomentValues, topic: string): string[] => values.filter((v) => v.topic === topic).map((v) => canonicalJson(v.params));

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
      const expected = momentParams(active).map(canonicalJson);
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
      const allowed = new Set(momentParams(active).map(canonicalJson));
      const inactiveOnly = momentParams(inactive).map(canonicalJson).filter((p) => !allowed.has(p));
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

// SP4.1a f34 (F6, C38, C62a, C76): a moment replays its recording as a replay does, with the recording's priors and
// decisions sidecars (`recordingDecisions`), so a captured moment of a session with a calibration pick computes on the
// picked snapshot, as the live run did. The sidecars are written by hand next to a copy of the segment in a temporary
// dir (C84: no data dir, no priors store).
describe('captureMoment and the recording\'s sidecars', () => {
  /** The record of LAP10 before which the recorded pick is handed to the run. */
  const PICK_AT = 800;
  const snapshot = (setId: string, setName: string, greenMs: number): PriorsSnapshot => ({
    fingerprint: `fp-${setId}`, setId, setName, sources: 2,
    entries: { 'pitLoss.ms.green': known(greenMs, 0), 'pitLoss.ms.sc': known(greenMs - 9_000, 0) },
  });
  const dry = snapshot('dry', 'Dry', 21_500);
  const wet = snapshot('wet', 'Wet', 24_000);

  /** A copy of LAP10 with a priors sidecar (the run started on `dry`, picked `wet`) and the pick in its decisions sidecar. */
  function recordingWithPick(): string {
    const path = join(mkdtempSync(join(tmpdir(), 'moment-pick-')), LAP10);
    copyFileSync(segmentPath(LAP10), path);
    writeFileSync(`${path}.priors.json`, JSON.stringify({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry, [wet.fingerprint]: wet } }));
    writeFileSync(`${path}.decisions.json`, JSON.stringify([{ recordIndex: PICK_AT, decision: { kind: 'calibrationChosen', setId: 'wet', snapshot: wet.fingerprint } }]));
    return path;
  }

  /** The receive-time offset of LAP10's record `index` from its first record. */
  async function offsetOf(index: number): Promise<number> {
    let first: number | undefined;
    let i = 0;
    for await (const record of readPwrec(segmentPath(LAP10))) {
      first ??= record.t;
      if (i++ === index) return record.t - first;
    }
    throw new Error(`LAP10 has no record ${index}`);
  }

  it('a captured moment of a recording with a calibration pick uses the picked snapshot', async () => {
    const path = recordingWithPick();
    const active = (values: MomentValues) => find(values, 'calibration.active')?.value as CalibrationActiveValue | undefined;
    // Before the pick: the run's start snapshot, from the priors sidecar.
    const before = await offsetOf(PICK_AT - 400);
    expect(before).toBeLessThan(await offsetOf(PICK_AT));
    expect(active(await captureMoment(path, before))).toMatchObject({ known: true, value: { setId: 'dry', setName: 'Dry', snapshot: dry.fingerprint, picked: false } });
    // After it: the picked snapshot, from the decisions sidecar.
    expect(active(await captureMoment(path, 1_000_000))).toMatchObject({ known: true, value: { setId: 'wet', setName: 'Wet', snapshot: wet.fingerprint, picked: true } });
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
