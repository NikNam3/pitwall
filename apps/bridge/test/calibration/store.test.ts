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
  type CarId, type FittedSource, type Known, type LapUse, type PriorsEntries, type PriorsSnapshot, type SessionUid, type SourceFit,
  type WeekendPhase,
} from '@pitwall/domain';
import { definePriors, type PriorsCtx, type ProjectionState, type StoredSource } from '@pitwall/engine/readers';
import { newSetId } from '../../src/calibration/sets.ts';
import { CalibrationStore, type CalibrationAction } from '../../src/calibration/store.ts';
import type { Feature } from '../../src/features/feature.ts';
import type { ValueFor } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import type { SessionKey } from '../../src/storage/db.ts';
import type { SessionsOnTrack, TrackSession } from '../../src/storage/weekend-repository.ts';
import { lap, stint } from '../storage/records.ts';

const TRACK = 10;
const OTHER_TRACK = 11;
const car = (n: number): CarId => n as CarId;
/**
 * Our cars (team 0: the feed's player car 0 and its teammate car 1) and a rival (car 2, team 1), each with its driver
 * name as the stored row reads it (SP4.1a fx2: `known(name, 0)`; a slot without one `unknown('notReceived')`).
 */
const CARS = [
  { carId: car(0), carKey: { teamId: 0, raceNumber: 44 }, driver: known('Driver Zero', 0) },
  { carId: car(1), carKey: { teamId: 0, raceNumber: 63 }, driver: known('Driver One', 0) },
  { carId: car(2), carKey: { teamId: 1, raceNumber: 16 }, driver: known('Rival Two', 0) },
];
const day = (d: number): string => `2026-10-${String(d).padStart(2, '0')}T20:00:00.000Z`;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// --- fake stored sessions -------------------------------------------------------------------------------------------

type StintSpec = { car: number; firstLap: number; lastLap: number; lapMs?: (lapNumber: number) => number };

/**
 * A complete stored session of the feed whose player is car 0, on `trackId`, with the stints (and their laps) given;
 * `stale`: stored under another rules version (`staleOf`). `cars` (default `CARS`) and `teammateCar` (default car 1, the
 * teammate the engine placed, stored with the session: SP4.1a f34, C43) stand for its stored row; `phase` (default a
 * grand-prix race) for its weekend-phase span.
 */
function trackSession(uid: string, o: {
  startedAt: string; stints: StintSpec[]; weekendId?: string; trackId?: number; stale?: boolean;
  cars?: TrackSession['cars']; teammateCar?: CarId | null; phase?: WeekendPhase;
}): TrackSession {
  const projection: ProjectionState = {
    laps: o.stints.flatMap((s) => range(s.firstLap, s.lastLap).map((n) => lap(s.car, n, { lapTimeMs: s.lapMs?.(n) ?? 90_000 + n }))),
    stints: o.stints.map((s) => stint(s.car, s.firstLap, { lastLap: s.lastLap })),
    pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], spans: {},
  };
  const session: TrackSession = {
    sessionUid: uid as SessionUid, weekendId: o.weekendId ?? 'W1', seasonId: 'S1', playerCar: car(0),
    teammateCar: o.teammateCar === undefined ? car(1) : o.teammateCar, trackId: o.trackId ?? TRACK,
    startedAt: o.startedAt, pwrecPath: null, settings: {}, cars: o.cars ?? CARS, rulesVersion: 'current', complete: true,
    phase: o.phase ?? { kind: 'race', format: 'grandPrix' }, stale: false, projection, track: unknown('notApplicable'),
  };
  return o.stale === true ? staleOf(session) : session;
}

/**
 * `s` as stored under another rules version: it awaits its rebuild (C61), so it comes with neither its projection nor
 * its weekend phase (both would be read from the stale log).
 */
function staleOf(s: TrackSession): TrackSession {
  return {
    sessionUid: s.sessionUid, weekendId: s.weekendId, seasonId: s.seasonId, playerCar: s.playerCar, teammateCar: s.teammateCar, trackId: s.trackId, startedAt: s.startedAt,
    pwrecPath: s.pwrecPath, settings: s.settings, cars: s.cars, rulesVersion: 'old', complete: s.complete, track: s.track,
    stale: true, projection: undefined,
  };
}

/**
 * A fake read of the stored sessions; `sessions` may be replaced to stand for a rebuild, a deleted or a new session.
 * `newestTrackId` (SP4.1a fx2) is the track of the newest of them by start, `null` without one, as storage answers it.
 */
function fakeRepo(sessions: TrackSession[]): { sessions: TrackSession[]; repo: SessionsOnTrack } {
  const state = { sessions, repo: undefined as unknown as SessionsOnTrack };
  const repo = {
    sessionsOnTrack: (trackId: number) => state.sessions.filter((s) => s.trackId === trackId),
    newestTrackId: (): number | null => state.sessions.toSorted((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]?.trackId ?? null,
  };
  state.repo = repo;
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

type Rebuild = (keys: readonly SessionKey[]) => Promise<void>;
type Setup = {
  sessions: TrackSession[]; dir?: string; features?: ReturnType<typeof fakeFeatures>; config?: Record<string, Record<string, number>>;
  /** The rebuild the store asks for (C61); by default one that stays pending, so a stale session stays stale. */
  rebuild?: Rebuild;
};

function setup({
  sessions, dir = mkdtempSync(join(tmpdir(), 'calibration-')), features = fakeFeatures(), config = { fake: { weight: 1 } },
  rebuild = vi.fn<Rebuild>(() => new Promise<void>(() => {})),
}: Setup) {
  const repo = fakeRepo(sessions);
  const h = fakeHub();
  const store = CalibrationStore.open(dir, {
    features: features.features, repo: repo.repo, config, hub: h.hub, log: createLogger({ level: 'silent' }), rebuild,
  });
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
/** The fit if the store could read its source (not skipped). */
const fitted = (fit: SourceFit | undefined): FittedSource | undefined => (fit !== undefined && fit.skipped === undefined ? fit : undefined);
/** The set's snapshot from the store; fails the test when the store has none (`undefined`, an unknown set, C3). */
function snapshotOf(store: CalibrationStore, trackId: number, setId: string): PriorsSnapshot {
  const snapshot: PriorsSnapshot | undefined = store.snapshotOf(trackId, setId);
  if (snapshot === undefined) throw new Error(`the store has no snapshot of set ${setId} on track ${trackId}`);
  return snapshot;
}
/** Lets every settled promise's callbacks run. */
const settle =() => new Promise<void>((resolve) => { setImmediate(resolve); });

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
    expect(snapshotOf(t.store, TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 4 });

    t.ok({ kind: 'calibration.lap.include', trackId: TRACK, setId: id, source: { ...source, excludedLaps: [3] }, lap: 3 });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([source]);
    expect(lapsSeen()).toEqual([1, 2, 3, 4, 5]);

    const before = t.features.calls.count.length;
    t.ok({ kind: 'calibration.source.remove', trackId: TRACK, setId: id, source });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([]);
    expect(t.features.calls.count.slice(before).some((c) => c.length === 0)).toBe(true);
    expect(snapshotOf(t.store, TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 0 });
  });

  it('an override replaces the computed entry; clearing restores it; an override-only key is unknown until set', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    const entry = (key: string) => snapshotOf(t.store, TRACK, id).entries[key];
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
    const computed = snapshotOf(first.store, TRACK, id).entries;
    expect(existsSync(join(dir, 'priors.sqlite'))).toBe(true);
    first.close();

    // The same versions, sources, overrides and config: nothing of the set is computed again.
    const same = setup({ sessions: [s1, s2], dir });
    expect(snapshotOf(same.store, TRACK, id).entries).toEqual(computed);
    expect(callsOver(same.features.calls.mean, 2)).toEqual([]);
    expect(callsOver(same.features.calls.count, 2)).toEqual([]);
    same.close();

    // A new version of one entry recomputes that entry only.
    const bumped = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }) });
    expect(snapshotOf(bumped.store, TRACK, id).entries).toEqual(computed);
    expect(callsOver(bumped.features.calls.mean, 2).length).toBeGreaterThan(0);
    expect(callsOver(bumped.features.calls.count, 2)).toEqual([]);
    bumped.close();

    // Another config is another fingerprint.
    const reconfigured = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(snapshotOf(reconfigured.store, TRACK, id).entries['fake.lapCount']).toMatchObject({ known: true, value: 20 });
    expect(callsOver(reconfigured.features.calls.count, 2).length).toBeGreaterThan(0);

    // Other sources (an excluded lap) are another fingerprint.
    const before = callsOver(reconfigured.features.calls.count, 2).length;
    reconfigured.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1), lap: 5 });
    expect(callsOver(reconfigured.features.calls.count, 2).length).toBeGreaterThan(before);
    const edited = snapshotOf(reconfigured.store, TRACK, id).entries;
    expect(edited['fake.lapCount']).toMatchObject({ known: true, value: 18 });
    reconfigured.close();

    // The cache deleted: the entries are computed again from the set files, equal.
    for (const file of ['priors.sqlite', 'priors.sqlite-wal', 'priors.sqlite-shm']) rmSync(join(dir, file), { force: true });
    const rebuilt = setup({ sessions: [s1, s2], dir, features: fakeFeatures({ meanVersion: 2 }), config: { fake: { weight: 2 } } });
    expect(snapshotOf(rebuilt.store, TRACK, id).entries).toEqual(edited);
    expect(callsOver(rebuilt.features.calls.count, 2).length).toBeGreaterThan(0);
  });

  it('an invalid action is rejected with a reason and changes nothing', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }, { car: 2, firstLap: 1, lastLap: 5 }] });
    const elsewhere = trackSession('9', { startedAt: day(2), trackId: OTHER_TRACK, stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1, elsewhere] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    const files = calibrationFiles(t.dir);
    const published = t.published.length;
    const entries = snapshotOf(t.store, TRACK, id).entries;

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
    expect(snapshotOf(t.store, TRACK, id).entries).toEqual(entries);
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
    expect(t.store.preselect(10)).toEqual(snapshotOf(t.store, 10, recent));
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
    t.repo.sessions = [kept, trackSession('gone', { startedAt: day(2), stints: [] }), staleOf(stale)];
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
    expect(snapshotOf(t.store, TRACK, id).entries['fake.meanLapMs']).toMatchObject({ known: true, value: 91_003 });
  });

  it('a skipped source carries no placeholder values (C3)', () => {
    const at = (uid: string, d: number) => trackSession(uid, { startedAt: day(d), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const deleted = at('deleted', 1), gone = at('gone', 2), stale = at('stale', 3), kept = at('kept', 4);
    const t = setup({ sessions: [deleted, gone, stale, kept] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(deleted, 0, 1), sourceOf(gone, 0, 1), sourceOf(stale, 0, 1), sourceOf(kept, 0, 1)]);

    // One session is deleted, one lost the stint in a rebuild, one awaits its rebuild (C61).
    t.repo.sessions = [trackSession('gone', { startedAt: day(2), stints: [] }), staleOf(stale), kept];
    t.store.recompute('rebuild');
    const skippedOf = (s: TrackSession) => t.fitOf(id, sourceOf(s, 0, 1));

    // Nothing is known of a source whose session is gone: no date, no compound (C3: unknown, never a placeholder).
    expect(skippedOf(deleted)).toMatchObject({ skipped: 'missing', sessionDate: { known: false }, compound: { known: false } });
    // Its session is still stored: its date is known; its stint, and so its compound, is not.
    expect(skippedOf(gone)).toMatchObject({ skipped: 'missing', sessionDate: { known: true, value: day(2) }, compound: { known: false } });
    // A session awaiting its rebuild is read for its row only: its date is known, its projection is not served.
    expect(skippedOf(stale)).toMatchObject({ skipped: 'stale', sessionDate: { known: true, value: day(3) }, compound: { known: false } });
    // A skipped source carries no laps, lap list, entries or residuals at all: not as zeros, not as empty lists. SP4.1a
    // fx2: it carries its session's weekend phase and its car's driver, each `Known` (C3).
    for (const s of [deleted, gone, stale]) {
      expect(Object.keys(skippedOf(s) ?? {}).toSorted(), s.sessionUid).toEqual(['compound', 'driver', 'phase', 'sessionDate', 'skipped', 'source']);
    }
    expect(fitted(skippedOf(kept))).toMatchObject({ sessionDate: day(4), compound: 'medium', laps: 5 });
  });

  it('reading a stale session requests its rebuild once, then recomputes', async () => {
    const at = (uid: string, d: number, base: number) =>
      trackSession(uid, { startedAt: day(d), stints: [{ car: 0, firstLap: 1, lastLap: 5, lapMs: (n) => base + n }] });
    const inSet = at('in-set', 1, 91_000), offered = at('offered', 2, 92_000);
    // What the rebuilds produce: the current rules version gives the same recordings other lap times.
    const rebuilt = [at('in-set', 1, 93_000), at('offered', 2, 94_000)];
    const pending: Array<() => void> = [];
    const rebuild = vi.fn<Rebuild>(() => new Promise<void>((resolve) => { pending.push(resolve); }));
    const t = setup({ sessions: [inSet], rebuild });
    const id = t.createSet(TRACK, 'Set', [sourceOf(inSet, 0, 1)]);
    expect(rebuild).not.toHaveBeenCalled();
    const requested = () => rebuild.mock.calls.flatMap(([keys]) => keys).map((k) => `${k.sessionUid}/${k.weekendId}/${k.playerCar}`).toSorted();

    // Both sessions are now of another rules version: the set reads one, the suggestions the other (C61: rebuilt when
    // first read).
    t.repo.sessions = [staleOf(inSet), staleOf(offered)];
    const recompute = vi.spyOn(t.store, 'recompute');
    t.store.recompute('sessionEnd');
    await settle();
    expect(requested()).toEqual(['in-set/W1/0', 'offered/W1/0']);
    expect(t.fitOf(id, sourceOf(inSet, 0, 1))?.skipped).toBe('stale');

    // Read again while the rebuilds are pending: no second request.
    t.store.recompute('sessionEnd');
    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.limitPct', value: 80 });
    await settle();
    expect(requested()).toEqual(['in-set/W1/0', 'offered/W1/0']);
    expect(recompute).not.toHaveBeenCalledWith('rebuild');

    // The rebuilds finish: the store recomputes from the rebuilt projections.
    t.repo.sessions = rebuilt;
    for (const resolve of pending) resolve();
    await vi.waitFor(() => expect(recompute).toHaveBeenCalledWith('rebuild'));
    const fit = fitted(t.fitOf(id, sourceOf(inSet, 0, 1)));
    expect(fit).toMatchObject({ laps: 5, sessionDate: day(1) });
    expect(valueOf(fit?.entries['fake.meanLapMs'])).toBe(93_003);
    expect(valueOf(snapshotOf(t.store, TRACK, id).entries['fake.meanLapMs'])).toBe(93_003);
    const candidates = t.last<CalibrationCandidatesValue>('calibration.candidates').byTrack[TRACK] ?? [];
    expect(candidates.map((c) => c.source)).toEqual([sourceOf(offered, 0, 1)]);
    expect(valueOf(fitted(candidates[0])?.entries['fake.meanLapMs'])).toBe(94_003);
    // Nothing is stale any more: nothing is requested again.
    expect(requested()).toEqual(['in-set/W1/0', 'offered/W1/0']);
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
    expect(valueOf(fitted(candidates[0])?.entries['fake.meanLapMs'])).toBe(mean(range(6, 10).map((n) => 90_000 + n)));
  });

  it('per-source values and residuals come from the declared functions', () => {
    const a = trackSession('a', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 4, lapMs: (n) => 90_000 + n }] });
    const b = trackSession('b', { startedAt: day(2), stints: [{ car: 0, firstLap: 1, lastLap: 4, lapMs: (n) => 92_000 + n }] });
    const t = setup({ sessions: [a, b] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(a, 0, 1), sourceOf(b, 0, 1)]);
    const meanA = mean(range(1, 4).map((n) => 90_000 + n)), meanB = mean(range(1, 4).map((n) => 92_000 + n));
    const meanSet = mean([...range(1, 4).map((n) => 90_000 + n), ...range(1, 4).map((n) => 92_000 + n)]);

    expect(valueOf(snapshotOf(t.store, TRACK, id).entries['fake.meanLapMs'])).toBe(meanSet);
    const fitA = fitted(t.fitOf(id, sourceOf(a, 0, 1))), fitB = fitted(t.fitOf(id, sourceOf(b, 0, 1)));
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
      fitted(fit)?.lapList.map((l) => ({ lapNumber: l.lapNumber, ms: valueOf(l.lapTimeMs), excluded: l.excluded, use: l.use.known ? l.use.value : l.use.reason }));

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

  // SP4.1a f34 (F4, C62a): a snapshot is named by its fingerprint, so the fingerprint hashes the whole snapshot (set id,
  // set name, sources count and entries), not its entries alone. This ports the earlier "equal for equal entries" test:
  // its entry half stays, its "equal sets, equal fingerprint" half is reversed by F4.
  it('a snapshot\'s fingerprint changes with any entry and is the same again when the entries are', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'A', [sourceOf(s1, 0, 1)]);
    const print = () => snapshotOf(t.store, TRACK, id).fingerprint;
    const first = print();

    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.meanLapMs', value: 95_000 });
    expect(print()).not.toBe(first);
    t.ok({ kind: 'calibration.override.clear', trackId: TRACK, setId: id, key: 'fake.meanLapMs' });
    expect(print()).toBe(first);

    t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.limitPct', value: 50 });
    expect(print()).not.toBe(first);
    t.ok({ kind: 'calibration.override.clear', trackId: TRACK, setId: id, key: 'fake.limitPct' });
    expect(print()).toBe(first);

    t.ok({ kind: 'calibration.lap.exclude', trackId: TRACK, setId: id, source: sourceOf(s1, 0, 1), lap: 1 });
    expect(print()).not.toBe(first);
  });

  it('two sets with equal entries have different snapshot fingerprints', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const a = t.createSet(TRACK, 'A', [sourceOf(s1, 0, 1)]);
    t.ok({ kind: 'calibration.set.copy', trackId: TRACK, setId: a, name: 'B' });
    const b = t.setId(TRACK, 'B');
    const snapA = snapshotOf(t.store, TRACK, a), snapB = snapshotOf(t.store, TRACK, b);
    expect(snapB.entries).toEqual(snapA.entries);
    expect(snapB.sources).toBe(snapA.sources);
    expect(snapB.fingerprint).not.toBe(snapA.fingerprint);

    // The name is part of the snapshot: a rename names another snapshot, renaming it back the same one again.
    const before = snapB.fingerprint;
    t.ok({ kind: 'calibration.set.rename', trackId: TRACK, setId: b, name: 'B renamed' });
    expect(snapshotOf(t.store, TRACK, b).fingerprint).not.toBe(before);
    t.ok({ kind: 'calibration.set.rename', trackId: TRACK, setId: b, name: 'B' });
    expect(snapshotOf(t.store, TRACK, b).fingerprint).toBe(before);

    // Two sets without sources and with equal overrides: equal entries, equal sources count, still two snapshots.
    const c = t.createSet(TRACK, 'C'), d = t.createSet(TRACK, 'D');
    for (const id of [c, d]) t.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.limitPct', value: 80 });
    const snapC = snapshotOf(t.store, TRACK, c), snapD = snapshotOf(t.store, TRACK, d);
    expect(snapD.entries).toEqual(snapC.entries);
    expect(snapD.fingerprint).not.toBe(snapC.fingerprint);
  });

  it('a snapshot\'s fingerprint is stable across a reload of the same set', () => {
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const dir = mkdtempSync(join(tmpdir(), 'calibration-'));
    const first = setup({ sessions: [s1], dir });
    const id = first.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    first.ok({ kind: 'calibration.override.set', trackId: TRACK, setId: id, key: 'fake.limitPct', value: 80 });
    const before = snapshotOf(first.store, TRACK, id);
    first.close();

    // Reloaded from the set file, with the cache in place.
    const reloaded = setup({ sessions: [s1], dir });
    expect(snapshotOf(reloaded.store, TRACK, id)).toEqual(before);
    reloaded.close();

    // Reloaded with the cache deleted: the entries are computed again, the fingerprint is the same.
    for (const file of ['priors.sqlite', 'priors.sqlite-wal', 'priors.sqlite-shm']) rmSync(join(dir, file), { force: true });
    const recomputed = setup({ sessions: [s1], dir });
    expect(snapshotOf(recomputed.store, TRACK, id).fingerprint).toBe(before.fingerprint);
  });

  // SP4.1a f34 (F3, C43): which cars are ours is the engine's placement (the player and the teammate it placed, stored
  // with the session), not a rule of the bridge over the slots' teams.
  it('suggestions take the stored teammate, not every slot of the player\'s team', () => {
    // Cars 0 (the player), 1 and 2 are of one team; the engine placed car 2 as the teammate. Car 3 is a rival.
    const cars = [
      { carId: car(0), carKey: { teamId: 0, raceNumber: 44 }, driver: unknown('notReceived') },
      { carId: car(1), carKey: { teamId: 0, raceNumber: 63 }, driver: unknown('notReceived') },
      { carId: car(2), carKey: { teamId: 0, raceNumber: 12 }, driver: unknown('notReceived') },
      { carId: car(3), carKey: { teamId: 1, raceNumber: 16 }, driver: unknown('notReceived') },
    ];
    const stints = [0, 1, 2, 3].map((n) => ({ car: n, firstLap: 1, lastLap: 5 }));
    const placed = trackSession('placed', { startedAt: day(2), cars, teammateCar: car(2), stints });
    // The engine placed no teammate in this one: only the player's stints are ours.
    const alone = trackSession('alone', { startedAt: day(1), cars, teammateCar: null, stints });
    const t = setup({ sessions: [placed, alone] });
    t.createSet(TRACK, 'Set');
    t.store.recompute('sessionEnd');

    const candidates = t.last<CalibrationCandidatesValue>('calibration.candidates').byTrack[TRACK] ?? [];
    expect(candidates.map((c) => c.source)).toEqual([sourceOf(placed, 0, 1), sourceOf(placed, 2, 1), sourceOf(alone, 0, 1)]);
  });

  it('a source of a same-team slot that is not the stored teammate is rejected', () => {
    const cars = [
      { carId: car(0), carKey: { teamId: 0, raceNumber: 44 }, driver: unknown('notReceived') },
      { carId: car(1), carKey: { teamId: 0, raceNumber: 63 }, driver: unknown('notReceived') },
      { carId: car(2), carKey: { teamId: 0, raceNumber: 12 }, driver: unknown('notReceived') },
    ];
    const s1 = trackSession('1', { startedAt: day(1), cars, teammateCar: car(2), stints: [0, 1, 2].map((n) => ({ car: n, firstLap: 1, lastLap: 5 })) });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set');
    t.ok({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 2, 1) });
    expect(t.apply({ kind: 'calibration.source.add', trackId: TRACK, setId: id, source: sourceOf(s1, 1, 1) })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(readSet(t.dir, TRACK, id).sources).toEqual([sourceOf(s1, 2, 1)]);
  });

  it('snapshotOf of an unknown set is undefined, not a throw', () => {
    // an unknown set is an expected problem (C3, C73): a pick of a deleted set, or of one on another track
    const s1 = trackSession('1', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const t = setup({ sessions: [s1] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(s1, 0, 1)]);
    expect(() => t.store.snapshotOf(TRACK, 'no-such-set')).not.toThrow();
    expect(t.store.snapshotOf(TRACK, 'no-such-set')).toBeUndefined();
    expect(t.store.snapshotOf(OTHER_TRACK, id)).toBeUndefined();
    t.ok({ kind: 'calibration.set.delete', trackId: TRACK, setId: id });
    expect(t.store.snapshotOf(TRACK, id)).toBeUndefined();
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

  // SP4.1a fx2 (C3, C43, C54, C62a; spec 3.1, 6): the approved calibration panel draws per source row its SESSION (the
  // source session's weekend phase), DATE and CAR (the source car's driver name as the stored session's Participants
  // last named it). The bridge only carries what storage holds; shown only.
  it('a fitted source carries its session\'s weekend phase and its car\'s driver name', () => {
    const qualifying: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 2 };
    const race = trackSession('race', { startedAt: day(2), stints: [{ car: 0, firstLap: 1, lastLap: 5 }, { car: 1, firstLap: 1, lastLap: 5 }] });
    // In the qualifying session the teammate's slot came without a name (stored NULL, read unknown).
    const unnamed = [CARS[0]!, { ...CARS[1]!, driver: unknown('notReceived') }, CARS[2]!];
    const quali = trackSession('quali', { startedAt: day(1), phase: qualifying, cars: unnamed, stints: [{ car: 0, firstLap: 1, lastLap: 4 }, { car: 1, firstLap: 1, lastLap: 4 }] });
    const t = setup({ sessions: [race, quali] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(race, 0, 1), sourceOf(race, 1, 1), sourceOf(quali, 0, 1)]);

    expect(fitted(t.fitOf(id, sourceOf(race, 0, 1)))).toMatchObject({ phase: { kind: 'race', format: 'grandPrix' }, driver: { known: true, value: 'Driver Zero' } });
    expect(fitted(t.fitOf(id, sourceOf(race, 1, 1)))).toMatchObject({ phase: { kind: 'race', format: 'grandPrix' }, driver: { known: true, value: 'Driver One' } });
    expect(fitted(t.fitOf(id, sourceOf(quali, 0, 1)))).toMatchObject({ phase: qualifying, driver: { known: true, value: 'Driver Zero' } });

    // A candidate carries them too: the teammate's qualifying stint, its driver unknown, never an empty string (C3).
    t.store.recompute('sessionEnd');
    const candidates = t.last<CalibrationCandidatesValue>('calibration.candidates').byTrack[TRACK] ?? [];
    expect(candidates.map((c) => c.source)).toEqual([sourceOf(quali, 1, 1)]);
    expect(fitted(candidates[0])).toMatchObject({ phase: qualifying, driver: { known: false } });
  });

  it('a missing source\'s phase and driver are unknown', () => {
    const at = (uid: string, d: number) => trackSession(uid, { startedAt: day(d), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const deleted = at('deleted', 1), gone = at('gone', 2), stale = at('stale', 3);
    const t = setup({ sessions: [deleted, gone, stale] });
    const id = t.createSet(TRACK, 'Set', [sourceOf(deleted, 0, 1), sourceOf(gone, 0, 1), sourceOf(stale, 0, 1)]);

    // One session is deleted, one lost the stint in a rebuild, one awaits its rebuild (C61).
    t.repo.sessions = [trackSession('gone', { startedAt: day(2), stints: [] }), staleOf(stale)];
    t.store.recompute('rebuild');
    const skippedOf = (s: TrackSession) => t.fitOf(id, sourceOf(s, 0, 1));

    // Its session is gone: nothing is known of its phase or its car's driver.
    expect(skippedOf(deleted)).toMatchObject({ skipped: 'missing', phase: { known: false }, driver: { known: false } });
    // Its session is still stored, only the stint is gone: the session's phase and its row's driver name are still known.
    expect(skippedOf(gone)).toMatchObject({
      skipped: 'missing', phase: { known: true, value: { kind: 'race', format: 'grandPrix' } }, driver: { known: true, value: 'Driver Zero' },
    });
    // A stale session's phase would be read from its stale log (C61): unknown; its row, and so the driver name, is still read.
    expect(skippedOf(stale)).toMatchObject({ skipped: 'stale', phase: { known: false }, driver: { known: true, value: 'Driver Zero' } });
  });

  it('calibration.candidates names the newest stored session\'s track, null without one', () => {
    const none = setup({ sessions: [] });
    expect(none.last<CalibrationCandidatesValue>('calibration.candidates').newestTrackId).toBeNull();
    none.close();

    // The newest by start, whether or not a set exists on its track or it offers a candidate.
    const older = trackSession('older', { startedAt: day(1), stints: [{ car: 0, firstLap: 1, lastLap: 5 }] });
    const newer = trackSession('newer', { startedAt: day(3), trackId: OTHER_TRACK, stints: [] });
    const t = setup({ sessions: [newer, older] });
    t.createSet(TRACK, 'Set', [sourceOf(older, 0, 1)]);
    expect(t.last<CalibrationCandidatesValue>('calibration.candidates').newestTrackId).toBe(OTHER_TRACK);

    // A session stored later on another track: the next publish names it.
    t.repo.sessions = [...t.repo.sessions, trackSession('newest', { startedAt: day(5), trackId: 12, stints: [] })];
    t.store.recompute('sessionEnd');
    expect(t.last<CalibrationCandidatesValue>('calibration.candidates').newestTrackId).toBe(12);
  });

  // Ruling R32: `defaults` is no set's id; it would clash with the shell's `calibration.choose.defaults` command.
  it('a set named defaults gets the id defaults-2', () => {
    expect(newSetId('defaults', new Set())).toBe('defaults-2');
    expect(newSetId('Defaults', new Set(['defaults-2']))).toBe('defaults-3');
    const t = setup({ sessions: [] });
    t.ok({ kind: 'calibration.set.create', trackId: TRACK, name: 'defaults' });
    expect(t.setId(TRACK, 'defaults')).toBe('defaults-2');
    t.ok({ kind: 'calibration.set.copy', trackId: TRACK, setId: 'defaults-2', name: 'Defaults' });
    expect(t.setId(TRACK, 'Defaults')).toBe('defaults-3');
    expect(t.sets().map((s) => s.id)).not.toContain('defaults');
    expect(existsSync(setPath(t.dir, TRACK, 'defaults'))).toBe(false);
  });
});
