// The calibration store (SP4.1a Task 5; C62a, spec 3.1 to 3.3): the bridge owns the calibration sets (files under
// `calibration/<trackId>/`, the source of truth) and the priors store (`priors.sqlite`, a cache: deleting it loses
// nothing). It validates every calibration uiAction and rejects an invalid one with a reason (C73), runs the units'
// declared priors functions over the sets' sources (the units judge, C43; the store only orders and stores) and
// publishes `calibration.sets`, `.values` and `.candidates` itself (C54, C55). Every test owns a temporary data dir and
// a fake read of the stored sessions (C84): no real storage, no priors store of the user.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import {
  known, unknown,
  type CalibrationCandidatesValue, type CalibrationSet, type CalibrationSetsValue, type CalibrationSource, type CalibrationValuesValue,
  type CarId, type Known, type LapUse, type PriorsEntries, type SessionUid, type SourceFit,
} from '@pitwall/domain';
import { definePriors, type PriorsCtx, type ProjectionState, type StoredSource } from '@pitwall/engine/readers';
import { CalibrationStore, type CalibrationAction } from '../../src/calibration/store.ts';
import type { Feature } from '../../src/features/feature.ts';
import type { ValueFor } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import type { SessionsOnTrack, TrackSession } from '../../src/storage/weekend-repository.ts';
import { lap, stint } from '../storage/records.ts';

const TRACK = 10;
const OTHER_TRACK = 11;
const car = (n: number): CarId => n as CarId;
/** Our cars (team 0: the feed's player car 0 and its teammate car 1) and a rival (car 2, team 1). */
const CARS = [
  { carId: car(0), carKey: { teamId: 0, raceNumber: 44 } },
  { carId: car(1), carKey: { teamId: 0, raceNumber: 63 } },
  { carId: car(2), carKey: { teamId: 1, raceNumber: 16 } },
];
const day = (d: number): string => `2026-10-${String(d).padStart(2, '0')}T20:00:00.000Z`;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// --- fake stored sessions -------------------------------------------------------------------------------------------

type StintSpec = { car: number; firstLap: number; lastLap: number; lapMs?: (lapNumber: number) => number };

/** A complete stored session of the feed whose player is car 0, on `trackId`, with the stints (and their laps) given. */
function trackSession(uid: string, o: { startedAt: string; stints: StintSpec[]; weekendId?: string; trackId?: number; stale?: boolean }): TrackSession {
  const projection: ProjectionState = {
    laps: o.stints.flatMap((s) => range(s.firstLap, s.lastLap).map((n) => lap(s.car, n, { lapTimeMs: s.lapMs?.(n) ?? 90_000 + n }))),
    stints: o.stints.map((s) => stint(s.car, s.firstLap, { lastLap: s.lastLap })),
    pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], spans: {},
  };
  const stale = o.stale ?? false;
  return {
    sessionUid: uid as SessionUid, weekendId: o.weekendId ?? 'W1', seasonId: 'S1', playerCar: car(0), trackId: o.trackId ?? TRACK,
    startedAt: o.startedAt, pwrecPath: null, settings: {}, cars: CARS, rulesVersion: stale ? 'old' : 'current', complete: true,
    phase: { kind: 'race', format: 'grandPrix' }, stale, projection: stale ? undefined : projection, track: unknown('notApplicable'),
  };
}

/** A fake read of the stored sessions; `sessions` may be replaced to stand for a rebuild or a deleted session. */
function fakeRepo(sessions: TrackSession[]): { sessions: TrackSession[]; repo: SessionsOnTrack } {
  const state = { sessions, repo: undefined as unknown as SessionsOnTrack };
  state.repo = { sessionsOnTrack: (trackId: number) => state.sessions.filter((s) => s.trackId === trackId) };
  return state;
}

/** The source naming `s`'s stint of `carNumber` that starts at `firstLap`. */
const sourceOf = (s: TrackSession, carNumber: number, firstLap: number, excludedLaps: number[] = []): CalibrationSource => ({
  sessionUid: s.sessionUid, weekendId: s.weekendId, feedCar: s.playerCar, car: car(carNumber), firstLap, excludedLaps,
});

// --- fake features --------------------------------------------------------------------------------------------------

const meanOf = (sources: readonly StoredSource[]): Known<number> => {
  const laps = sources.flatMap((s) => s.laps);
  return laps.length === 0 ? unknown('insufficientData') : known(Math.round(laps.reduce((sum, l) => sum + l.lapTimeMs, 0) / laps.length), 0);
};
const weightOf = (ctx: PriorsCtx): number => Number(ctx.config['fake']?.['weight'] ?? 1);
const diff = (a: Known<number> | undefined, b: Known<number> | undefined): Known<number> =>
  a?.known === true && b?.known === true ? known(a.value - b.value, 0) : unknown('insufficientData');

/**
 * One unit `fake` with two computed entries (`fake.meanLapMs`: the mean lap time, with a `residual`; `fake.lapCount`: the
 * laps times the config's `fake.weight`), one override-only key (`fake.limitPct`), a `candidate` (at least 3 laps) and,
 * unless `lapUse: false`, a `lapUse` (a lap over 95 s is down-weighted). Every aggregate call's sources are recorded.
 */
function fakeFeatures(o: { meanVersion?: number; lapUse?: boolean } = {}) {
  const calls = { mean: [] as StoredSource[][], count: [] as StoredSource[][] };
  const residual = vi.fn((source: PriorsEntries, set: PriorsEntries) => diff(source['fake.meanLapMs'], set['fake.meanLapMs']));
  const candidate = vi.fn((source: StoredSource, _ctx: PriorsCtx) => source.laps.length >= 3);
  const lapUse = (source: StoredSource): Record<number, LapUse> =>
    Object.fromEntries(source.laps.map((l) => [l.lapNumber, l.lapTimeMs > 95_000 ? 'downWeighted' : 'used']));
  const decl = definePriors('fake', {
    entries: {
      'fake.meanLapMs': {
        version: o.meanVersion ?? 1, range: [60_000, 200_000], residual,
        aggregate: (sources) => { calls.mean.push([...sources]); return meanOf(sources); },
      },
      'fake.lapCount': {
        version: 1, range: [0, 1_000],
        aggregate: (sources, ctx) => { calls.count.push([...sources]); return known(sources.reduce((n, s) => n + s.laps.length, 0) * weightOf(ctx), 0); },
      },
      'fake.limitPct': { version: 1, range: [30, 100] },
    },
    candidate,
    ...(o.lapUse !== false && { lapUse }),
  });
  const features: Feature[] = [{ name: 'fake', calculators: [], topics: [], priors: [decl] }];
  return { features, calls, residual, candidate };
}

/** The aggregate calls over exactly `n` sources: a set's own computation when the set has `n` > 1 sources. */
const callsOver = (calls: StoredSource[][], n: number): StoredSource[][] => calls.filter((c) => c.length === n);
/** The newest aggregate call that received the stint `source` names. */
const lastCallWith = (calls: StoredSource[][], source: CalibrationSource): StoredSource | undefined =>
  calls.toReversed().flatMap((c) => c).find((s) => s.source.sessionUid === source.sessionUid && s.source.car === source.car && s.source.firstLap === source.firstLap);

// --- the store under test -------------------------------------------------------------------------------------------

/** What the store published, in order, each value read at the time of publishing. */
function fakeHub() {
  const published: Array<{ topic: TopicName; value: unknown }> = [];
  const hub = { publishGlobal: (topic: TopicName, valueFor: ValueFor) => { published.push({ topic, value: valueFor({}) }); } };
  const count = (topic: string) => published.filter((p) => p.topic === topic).length;
  const last = <T>(topic: string): T => published.filter((p) => p.topic === topic).at(-1)?.value as T;
  return { hub, published, count, last };
}

const opened = new Set<CalibrationStore>();
afterEach(() => { for (const store of opened) store.close(); opened.clear(); });

type Setup = { sessions: TrackSession[]; dir?: string; features?: ReturnType<typeof fakeFeatures>; config?: Record<string, Record<string, number>> };

function setup({ sessions, dir = mkdtempSync(join(tmpdir(), 'calibration-')), features = fakeFeatures(), config = { fake: { weight: 1 } } }: Setup) {
  const repo = fakeRepo(sessions);
  const h = fakeHub();
  const store = CalibrationStore.open(dir, { features: features.features, repo: repo.repo, config, hub: h.hub, log: createLogger({ level: 'silent' }) });
  opened.add(store);
  const close = () => { store.close(); opened.delete(store); };
  const apply = (action: CalibrationAction) => store.apply(action);
  const ok = (action: CalibrationAction) => expect(store.apply(action)).toEqual({ ok: true });
  const sets = () => h.last<CalibrationSetsValue>('calibration.sets').sets;
  const setId = (trackId: number, name: string): string => {
    const set = sets().find((s) => s.trackId === trackId && s.name === name);
    if (set === undefined) throw new Error(`no set ${name} on track ${trackId}`);
    return set.id;
  };
  const fits = (id: string): SourceFit[] => h.last<CalibrationValuesValue>('calibration.values').bySet[id]?.fits ?? [];
  const fitOf = (id: string, source: CalibrationSource): SourceFit | undefined =>
    fits(id).find((f) => f.source.sessionUid === source.sessionUid && f.source.car === source.car && f.source.firstLap === source.firstLap);
  /** Creates a set on `trackId` with the sources given; returns its id. */
  const createSet = (trackId: number, name: string, sources: CalibrationSource[] = []): string => {
    ok({ kind: 'calibration.set.create', trackId, name });
    const id = setId(trackId, name);
    for (const source of sources) ok({ kind: 'calibration.source.add', trackId, setId: id, source });
    return id;
  };
  return { dir, store, repo, features, ...h, close, apply, ok, sets, setId, fits, fitOf, createSet };
}

const setPath = (dir: string, trackId: number, id: string) => join(dir, 'calibration', String(trackId), `${id}.json`);
const readSet = (dir: string, trackId: number, id: string): CalibrationSet => JSON.parse(readFileSync(setPath(dir, trackId, id), 'utf8')) as CalibrationSet;
/** Every file under `calibration/` with its content. */
const calibrationFiles = (dir: string): Record<string, string> => {
  const root = join(dir, 'calibration');
  if (!existsSync(root)) return {};
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name), 'utf8')]));
};
const valueOf = (entry: Known<number> | undefined): number | undefined => (entry?.known === true ? entry.value : undefined);
const mean = (values: number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

// --- the tests ------------------------------------------------------------------------------------------------------

describe('CalibrationStore', () => {
  it('create, copy, rename, delete write and remove the set files', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    t.ok({ kind: 'calibration.set.create', trackId: TRACK, name: 'Dry baseline' });
    const id = t.setId(TRACK, 'Dry baseline');
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const created = readSet(t.dir, TRACK, id);
    expect(created).toMatchObject({ id, trackId: TRACK, name: 'Dry baseline', sources: [], overrides: {} });
    expect(typeof created.createdAt).toBe('string');

    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1) });
    t.ok({ kind: 'calibration.set.copy', trackId: TRACK, setId: id, name: 'Dry copy' });
    const copyId = t.setId(TRACK, 'Dry copy');
    expect(copyId).not.toBe(id);
    expect(readSet(t.dir, TRACK, copyId)).toMatchObject({ id: copyId, trackId: TRACK, name: 'Dry copy', sources: [sourceOf(s1, 0, 1)] });

    t.ok({ kind: 'calibration.set.rename', trackId: TRACK, setId: id, name: 'Dry v2' });
    expect(readSet(t.dir, TRACK, id)).toMatchObject({ id, name: 'Dry v2', sources: [sourceOf(s1, 0, 1)] });

    t.ok({ kind: 'calibration.set.delete', trackId: TRACK, setId: copyId });
    expect(existsSync(setPath(t.dir, TRACK, copyId))).toBe(false);
    expect(readdirSync(join(t.dir, 'calibration', String(TRACK)))).toEqual([`${id}.json`]);
    expect(t.sets().map((s) => s.id)).toEqual([id]);
  });

  it('source add and remove; lap exclude and include', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set');
    const source = sourceOf(s1, 0, 1);
    const lapsSeen = () => lastCallWith(t.features.calls.mean, source)?.laps.map((l) => l.lapNumber);

    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([source]);
    expect(lapsSeen()).toEqual([1, 2, 3, 4, 5]);

    t.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: id, source, lap: 3 });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([{ ...source, excludedLaps: [3] }]);
    expect(lapsSeen()).toEqual([1, 2, 4, 5]);
    expect(t.store.snapshotOf(TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 4 });

    t.ok({ kind: 'calibration.lap.include', trackId: TRACK, setId: id, source: { ...source, excludedLaps: [3] }, lap: 3 });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([source]);
    expect(lapsSeen()).toEqual([1, 2, 3, 4, 5]);

    const before = t.features.calls.count.length;
    t.ok({ kind: 'calibration.source.remove', trackId: TRACK, setId: id, source });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([]);
    expect(t.features.calls.count.slice(before).some((c) => c.length === 0)).toBe(true);
    expect(t.store.snapshotOf(TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 0 });
  });

  it('an override replaces the computed entry; clearing restores it; an override-only key is unknown until set', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    const entry = (key: string) => t.store.snapshotOf(TRACK, id).entries[key];
    expect(entry('fake.meanLapMs')).toMatchObject({ known: true, value: 90_003 });

    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.meanLapMs', value: 95_000 });
    expect(entry('fake.meanLapMs')).toMatchObject({ known: true, value: 95_000 });
    expect(readSet(t.dir, TRACK, id).overrides).toEqual({ 'fake.meanLapMs': 95_000 });

    t.ok({ kind: 'calibration.override.clear', trackId: TRACK, setId: id, key: 'fake.meanLapMs' });
    expect(entry('fake.meanLapMs')).toMatchObject({ known: true, value: 90_003 });
    expect(readSet(t.dir, TRACK, id).overrides).toEqual({});

    expect(entry('fake.limitPct')?.known).toBe(false);
    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.limitPct', value: 80 });
    expect(entry('fake.limitPct')).toMatchObject({ known: true, value: 80 });
  });

  it('entries are cached; a version, fingerprint or config change recomputes; deleting the cache loses nothing', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const s2 = trackSession('2', { startedAt: day(2), stints: [{ car: 0, firstLap: 1, lastLap: 5, lapMs: (n) => 92_000 + n }] });
    const dir = mkdtempSync(join(tmpdir(), 'calibration-'));
    const first = setup({ sessions: [s1, s2], dir });
    const id = first.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1), sourceOf(s2, 0, 1)]);
    const computed = first.store.snapshotOf(TRACK, id).entries;
    expect(existsSync(join(dir, 'priors.sqlite'))).toBe(true);
    first.close();

    // The same versions, sources, overrides and config: nothing of the set is computed again.
    const same = setup({ sessions: [s1, s2], dir });
    expect(same.store.snapshotOf(TRACK, id).entries).toEqual(computed);
    expect(callsOver(same.features.calls.mean, 2)).toEqual([]);
    expect(callsOver(same.features.calls.count, 2)).toEqual([]);
    same.close();

    // A new version of one entry recomputes that entry only.
    const bumped = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }) });
    expect(bumped.store.snapshotOf(TRACK, id).entries).toEqual(computed);
    expect(callsOver(bumped.features.calls.mean, 2).length).toBeGreaterThan(0);
    expect(callsOver(bumped.features.calls.count, 2)).toEqual([]);
    bumped.close();

    // Another config is another fingerprint.
    const reconfigured = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(reconfigured.store.snapshotOf(TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 20 });
    expect(callsOver(reconfigured.features.calls.count, 2).length).toBeGreaterThan(0);

    // Other sources (an excluded lap) are another fingerprint.
    const before = callsOver(reconfigured.features.calls.count, 2).length;
    reconfigured.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1), lap: 5 });
    expect(callsOver(reconfigured.features.calls.count, 2).length).toBeGreaterThan(before);
    const edited = reconfigured.store.snapshotOf(TRACK, id).entries;
    expect(edited['fake.lapCount']).toMatchObject({ known: true, value: 18 });
    reconfigured.close();

    // The cache deleted: the entries are computed again from the set files, equal.
    for (const file of ['priors.sqlite', 'priors.sqlite-wal', 'priors.sqlite-shm']) rmSync(join(dir, file), { force: true });
    const rebuilt = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(rebuilt.store.snapshotOf(TRACK, id).entries).toEqual(edited);
    expect(callsOver(rebuilt.features.calls.count, 2).length).toBeGreaterThan(0);
  });

  it('an invalid action is rejected with a reason and changes nothing', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }, { car: 2, firstLap: 1, lastLap: 5 }] });
    const elsewhere = trackSession('9', { startedAt: day(2), trackId: OTHER_TRACK, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1, elsewhere] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    const files = calibrationFiles(t.dir);
    const published = t.published.length;
    const entries = t.store.snapshotOf(TRACK, id).entries;

    const invalid: Array<[string, CalibrationAction]> = [
      ['an override out of its range', { kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.meanLapMs', value: 10 }],
      ['an override of an undeclared key', { kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.nothing', value: 1 }],
      ['an unknown set', { kind: 'calibration.source.add', trackId: TRACK, setId: 'no-such-set', source: sourceOf(s1, 0, 1) }],
      ['a source of another track', { kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(elsewhere, 0, 1) }],
      ['a rival\'s stint', { kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 2, 1) }],
    ];
    for (const [what, action] of invalid) {
      const result = t.apply(action);
      expect(result, what).toMatchObject({ ok: false, reason: 'invalid' });
      expect(result.ok === false && typeof result.message === 'string' && result.message.length > 0, what).toBe(true);
    }
    expect(calibrationFiles(t.dir)).toEqual(files);
    expect(t.published.length).toBe(published);
    expect(t.store.snapshotOf(TRACK, id).entries).toEqual(entries);
  });

  it('a source names its stint by car and first lap; a teammate\'s stint is accepted', () => {
    const s1 = trackSession('1', {
      startedAt: day(1),
      stints: [{ car: 0, firstLap: 1, lastLap: 10 }, { car: 0, firstLap: 11, lastLap: 20 }, { car: 1, firstLap: 1, lastLap: 12 }],
    });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set');

    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 11) });
    const second = lastCallWith(t.features.calls.mean, sourceOf(s1, 0, 11));
    expect(second?.stint).toMatchObject({ carId: car(0), firstLap: 11, lastLap: 20 });
    expect(second?.laps.map((l) => [l.carId, l.lapNumber])).toEqual(range(11, 20).map((n) => [car(0), n]));
    expect(second?.phase).toEqual({ kind: 'race', format: 'grandPrix' });

    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 1, 1) });
    const teammate = lastCallWith(t.features.calls.mean, sourceOf(s1, 1, 1));
    expect(teammate?.stint).toMatchObject({ carId: car(1), firstLap: 1, lastLap: 12 });
    expect(teammate?.laps.map((l) => [l.carId, l.lapNumber])).toEqual(range(1, 12).map((n) => [car(1), n]));

    // No stint of car 0 starts at lap 5.
    expect(t.apply({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 5) })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([sourceOf(s1, 0, 11), sourceOf(s1, 1, 1)]);
  });

  it('preselection: newest lastUsedAt, else newest source session, else none', () => {
    const a10 = trackSession('10a', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const b10 = trackSession('10b', { startedAt: day(9), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const a11 = trackSession('11a', { startedAt: day(1), trackId: 11, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const b11 = trackSession('11b', { startedAt: day(5), trackId: 11, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [a10, b10, a11, b11] });

    // Track 10: a used set wins over a newer source session; of the used ones, the newest use.
    const old = t.createSet(10, 'Old use', [sourceOf(a10, 0, 1)]);
    const recent = t.createSet(10, 'Recent use', [sourceOf(a10, 0, 1)]);
    t.createSet(10, 'Never used', [sourceOf(b10, 0, 1)]);
    t.store.markUsed(10, old, day(2));
    t.store.markUsed(10, recent, day(3));
    expect(readSet(t.dir, 10, recent).lastUsedAt).toBe(day(3));
    expect(t.store.preselect(10)).toEqual(t.store.snapshotOf(10, recent));
    expect(t.store.preselect(10)?.setName).toBe('Recent use');

    // Track 11: none used: the set with the newest source session.
    t.createSet(11, 'Older sources', [sourceOf(a11, 0, 1)]);
    const newer = t.createSet(11, 'Newer sources', [sourceOf(a11, 0, 1), sourceOf(b11, 0, 1)]);
    t.createSet(11, 'Empty');
    expect(t.store.preselect(11)?.setId).toBe(newer);

    // Track 12: no set, or only a set with no source and no use: none.
    expect(t.store.preselect(12)).toBeNull();
    t.createSet(12, 'Empty');
    expect(t.store.preselect(12)).toBeNull();
  });

  it('a source whose stint is gone is missing, one whose session awaits a rebuild is stale; both are left out', () => {
    const at = (uid: string, d: number, base: number) => trackSession(uid, { startedAt: day(d), stints: [{ car: 0, firstLap: 1, lastLap: 5, lapMs: (n) => base + n }] });
    const kept = at('kept', 1, 91_000), gone = at('gone', 2, 99_000), stale = at('stale', 3, 99_000), deleted = at('deleted', 4, 99_000);
    const t = setup({ sessions: [kept, gone, stale, deleted] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(kept, 0, 1), sourceOf(gone, 0, 1), sourceOf(stale, 0, 1), sourceOf(deleted, 0, 1)]);

    // A rebuild dropped one stint, another session awaits its rebuild (C61), one session is deleted.
    t.repo.sessions = [
      kept,
      { ...gone, projection: { ...gone.projection!, stints: [], laps: [] } },
      { ...stale, stale: true, rulesVersion: 'old', projection: undefined },
    ];
    const calls = t.features.calls.mean.length;
    expect(() => t.store.recompute('rebuild')).not.toThrow();

    expect(t.fitOf(id, sourceOf(kept, 0, 1))?.skipped).toBeUndefined();
    expect(t.fitOf(id, sourceOf(gone, 0, 1))?.skipped).toBe('missing');
    expect(t.fitOf(id, sourceOf(stale, 0, 1))?.skipped).toBe('stale');
    expect(t.fitOf(id, sourceOf(deleted, 0, 1))?.skipped).toBe('missing');
    // Every source stays in the set file.
    expect(readSet(t.dir, TRACK, id).sources).toHaveLength(4);
    // Every aggregate after the rebuild rests on the kept source only.
    const after = t.features.calls.mean.slice(calls);
    expect(after.length).toBeGreaterThan(0);
    expect(after.flat().every((s) => s.source.sessionUid === 'kept')).toBe(true);
    expect(t.store.snapshotOf(TRACK, id).entries['fake.meanLapMs']).toMatchObject({ known: true, value: 91_003 });
  });

  it('suggestions: our cars\' stints not in the set that a declared candidate accepts, this weekend first, then newest', () => {
    // W2 is the weekend of the newest session; W1's session lies between W2's two.
    const w2late = trackSession('w2-late', {
      weekendId: 'W2', startedAt: day(5),
      stints: [{ car: 0, firstLap: 1, lastLap: 5 }, { car: 0, firstLap: 6, lastLap: 10 }, { car: 2, firstLap: 1, lastLap: 5 }, { car: 1, firstLap: 1, lastLap: 2 }],
    });
    const w1 = trackSession('w1', { weekendId: 'W1', startedAt: day(3), stints: [{ car: 0, firstLap: 1, lastLap: 6 }] });
    const w2early = trackSession('w2-early', { weekendId: 'W2', startedAt: day(1), stints: [{ car: 1, firstLap: 1, lastLap: 4 }] });
    const stale = trackSession('w2-stale', { weekendId: 'W2', startedAt: day(4), stale: true, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const elsewhere = trackSession('elsewhere', { weekendId: 'W3', startedAt: day(6), trackId: OTHER_TRACK, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [w2late, w1, w2early, stale, elsewhere] });
    t.createSet(TRACK, 'Set', [sourceOf(w2late, 0, 1)]);
    t.store.recompute('sessionEnd');

    const candidates = t.last<CalibrationCandidatesValue>('calibration.candidates').byTrack[TRACK] ?? [];
    expect(candidates.map((c) => c.source)).toEqual([sourceOf(w2late, 0, 6), sourceOf(w2early, 1, 1), sourceOf(w1, 0, 1)]);
    // The unit's `candidate` decided the two-lap stint, not the store.
    expect(t.features.candidate.mock.calls.some(([s]) => s.source.sessionUid === 'w2-late' && s.source.car === car(1) && s.stint.firstLap === 1)).toBe(true);
    // A candidate carries its own entries and lap counts.
    expect(candidates[0]).toMatchObject({ laps: 5, sessionDate: day(5), compound: 'medium' });
    expect(valueOf(candidates[0]?.entries['fake.meanLapMs'])).toBe(mean(range(6, 10).map((n) => 90_000 + n)));
  });

  it('per-source values and residuals come from the declared functions', () => {
    const a = trackSession('a', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 4, lapMs: (n) => 90_000 + n }] });
    const b = trackSession('b', { startedAt: day(2), stints: [{ car: 0, firstLap: 1, lastLap: 4, lapMs: (n) => 92_000 + n }] });
    const t = setup({ sessions: [a, b] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(a, 0, 1), sourceOf(b, 0, 1)]);
    const meanA = mean(range(1, 4).map((n) => 90_000 + n)), meanB = mean(range(1, 4).map((n) => 92_000 + n));
    const meanSet = mean([...range(1, 4).map((n) => 90_000 + n), ...range(1, 4).map((n) => 92_000 + n)]);

    expect(valueOf(t.store.snapshotOf(TRACK, id).entries['fake.meanLapMs'])).toBe(meanSet);
    const fitA = t.fitOf(id, sourceOf(a, 0, 1)), fitB = t.fitOf(id, sourceOf(b, 0, 1));
    expect(fitA).toMatchObject({ sessionDate: day(1), compound: 'medium', laps: 4 });
    expect(valueOf(fitA?.entries['fake.meanLapMs'])).toBe(meanA);
    expect(valueOf(fitB?.entries['fake.meanLapMs'])).toBe(meanB);
    expect(valueOf(fitA?.residuals['fake.meanLapMs'])).toBe(meanA - meanSet);
    expect(valueOf(fitB?.residuals['fake.meanLapMs'])).toBe(meanB - meanSet);
    expect(t.features.residual).toHaveBeenCalledWith(
      expect.objectContaining({ 'fake.meanLapMs': expect.objectContaining({ value: meanA }) }),
      expect.objectContaining({ 'fake.meanLapMs': expect.objectContaining({ value: meanSet }) }),
    );
  });

  it('per-source lap list and lap use come from the declared lapUse', () => {
    const times = [90_000, 96_000, 90_500, 91_000];
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 4, lapMs: (n) => times[n - 1]! }] });
    const listOf = (fit: SourceFit | undefined) =>
      fit?.lapList.map((l) => ({ lapNumber: l.lapNumber, ms: valueOf(l.lapTimeMs), excluded: l.excluded, use: l.use.known ? l.use.value : l.use.reason }));

    const withUse = setup({ sessions: [s1] });
    const id = withUse.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    withUse.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1), lap: 4 });
    const list = listOf(withUse.fitOf(id, sourceOf(s1, 0, 1)));
    expect(list?.slice(0, 3)).toEqual([
      { lapNumber: 1, ms: 90_000, excluded: false, use: 'used' },
      { lapNumber: 2, ms: 96_000, excluded: false, use: 'downWeighted' },
      { lapNumber: 3, ms: 90_500, excluded: false, use: 'used' },
    ]);
    expect(list?.[3]).toMatchObject({ lapNumber: 4, ms: 91_000, excluded: true });

    const withoutUse = setup({ sessions: [s1], features: fakeFeatures({ lapUse: false }) });
    const other = withoutUse.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    expect(listOf(withoutUse.fitOf(other, sourceOf(s1, 0, 1)))?.map((l) => l.use)).toEqual(['notApplicable', 'notApplicable', 'notApplicable', 'notApplicable']);
  });

  it('a snapshot\'s fingerprint is equal for equal entries and changes with any entry', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const a = t.createSet(TRACK, 'A', [sourceOf(s1, 0, 1)]);
    t.ok({ kind: 'calibration.set.copy', trackId: TRACK, setId: a, name: 'B' });
    const b = t.setId(TRACK, 'B');
    const print = (id: string) => t.store.snapshotOf(TRACK, id).fingerprint;
    expect(t.store.snapshotOf(TRACK, b).entries).toEqual(t.store.snapshotOf(TRACK, a).entries);
    expect(print(b)).toBe(print(a));

    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: b, key: 'fake.meanLapMs', value: 95_000 });
    expect(print(b)).not.toBe(print(a));
    t.ok({ kind: 'calibration.override.clear', trackId: TRACK, setId: b, key: 'fake.meanLapMs' });
    expect(print(b)).toBe(print(a));

    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: b, key: 'fake.limitPct', value: 50 });
    expect(print(b)).not.toBe(print(a));
    t.ok({ kind: 'calibration.override.clear', trackId: TRACK, setId: b, key: 'fake.limitPct' });
    expect(print(b)).toBe(print(a));

    t.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: b, source: sourceOf(s1, 0, 1), lap: 1 });
    expect(print(b)).not.toBe(print(a));
  });

  it('the topics are published on every change', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    for (const topic of ['calibration.sets', 'calibration.values', 'calibration.candidates']) expect(t.count(topic), topic).toBeGreaterThan(0);

    const counts = () => [t.count('calibration.sets'), t.count('calibration.values')];
    let [sets, values] = counts();
    t.ok({ kind: 'calibration.set.create', trackId: TRACK, name: 'Set' });
    const id = t.setId(TRACK, 'Set');
    expect(counts()[0]).toBeGreaterThan(sets!);
    expect(counts()[1]).toBeGreaterThan(values!);
    expect(t.last<CalibrationValuesValue>('calibration.values').bySet[id]).toBeDefined();

    [sets, values] = counts();
    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1) });
    expect(counts()[0]).toBeGreaterThan(sets!);
    expect(counts()[1]).toBeGreaterThan(values!);
    expect(t.sets().find((s) => s.id === id)?.sources).toEqual([sourceOf(s1, 0, 1)]);

    [sets, values] = counts();
    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.meanLapMs', value: 95_000 });
    expect(counts()[0]).toBeGreaterThan(sets!);
    expect(counts()[1]).toBeGreaterThan(values!);
    expect(t.last<CalibrationValuesValue>('calibration.values').bySet[id]?.entries['fake.meanLapMs']).toMatchObject({ known: true, value: 95_000 });

    [sets] = counts();
    t.store.markUsed(TRACK, id, day(2));
    expect(counts()[0]).toBeGreaterThan(sets!);
    expect(t.sets().find((s) => s.id === id)?.lastUsedAt).toBe(day(2));

    const candidates = t.count('calibration.candidates');
    t.store.recompute('sessionEnd');
    expect(t.count('calibration.candidates')).toBeGreaterThan(candidates);
  });
});
