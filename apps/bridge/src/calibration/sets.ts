// The calibration set files (C62a, spec 3.1): `<data dir>/calibration/<trackId>/<setId>.json`, user-authored and the
// source of truth (not a cache). Written atomically; a file that is not a set is skipped with one warning.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CalibrationSet, CalibrationSource, CarId, SessionUid } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';

const calibrationDir = (root: string): string => join(root, 'calibration');
const trackDir = (root: string, trackId: number): string => join(calibrationDir(root), String(trackId));
const setPath = (root: string, set: Pick<CalibrationSet, 'trackId' | 'id'>): string => join(trackDir(root, set.trackId), `${set.id}.json`);

/** Whether two sources name the same stint (their excluded laps aside). */
export const sameStint = (a: CalibrationSource, b: CalibrationSource): boolean =>
  a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.feedCar === b.feedCar && a.car === b.car && a.firstLap === b.firstLap;

/** A source's stint as a cache key part: its session's key, its car and its first lap. */
export const stintKey = (s: CalibrationSource): string => `${s.sessionUid}/${s.weekendId}/${s.feedCar}/${s.car}/${s.firstLap}`;

/** Ids no set gets: `defaults` would clash with the shell's `calibration.choose.defaults` command (ruling R32). */
const RESERVED_IDS: ReadonlySet<string> = new Set(['defaults']);

/** A kebab-case id for `name`, unique among `taken` and never reserved (`dry-baseline`, then `dry-baseline-2`, …). */
export function newSetId(name: string, taken: ReadonlySet<string>): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'set';
  const isTaken = (id: string): boolean => taken.has(id) || RESERVED_IDS.has(id);
  if (!isTaken(slug)) return slug;
  let n = 2;
  while (isTaken(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

/** Every set file under `<root>/calibration/`; a file that is not a set of its folder's track is skipped with a warning. */
export function loadSets(root: string, log: Logger): CalibrationSet[] {
  mkdirSync(calibrationDir(root), { recursive: true });
  const sets: CalibrationSet[] = [];
  const ids = new Set<string>();
  for (const track of readdirSync(calibrationDir(root), { withFileTypes: true })) {
    const trackId = Number(track.name);
    if (!track.isDirectory() || !Number.isInteger(trackId)) continue;
    for (const file of readdirSync(trackDir(root, trackId)).filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort()) {
      const path = join(trackDir(root, trackId), file);
      const parsed = parseJson(readText(path) ?? '');
      const set = parsed.ok ? decodeSet(parsed.value) : undefined;
      if (set === undefined || set.trackId !== trackId || `${set.id}.json` !== file || ids.has(set.id)) {
        log.warn({ path }, 'not a calibration set of its track (or a duplicate id): skipped');
        continue;
      }
      ids.add(set.id);
      sets.push(set);
    }
  }
  return sets;
}

export function writeSet(root: string, set: CalibrationSet): void {
  mkdirSync(trackDir(root, set.trackId), { recursive: true });
  writeAtomic(setPath(root, set), `${JSON.stringify(set, null, 2)}\n`);
}

export function removeSet(root: string, set: CalibrationSet): void {
  rmSync(setPath(root, set), { force: true });
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInteger = (v: unknown): v is number => Number.isInteger(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/** A set file's content rebuilt from its known fields; `undefined` when it is not a set (a hand edit may break one). */
function decodeSet(raw: unknown): CalibrationSet | undefined {
  if (!isObject(raw) || !isString(raw.id) || !isInteger(raw.trackId) || !isString(raw.name) || !isString(raw.createdAt)) return undefined;
  if (!Array.isArray(raw.sources) || !isObject(raw.overrides)) return undefined;
  const sources = raw.sources.map(decodeSource);
  if (sources.some((s) => s === undefined)) return undefined;
  const overrides = Object.entries(raw.overrides);
  if (overrides.some(([, v]) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
  if (raw.lastUsedAt !== undefined && !isString(raw.lastUsedAt)) return undefined;
  return {
    id: raw.id, trackId: raw.trackId, name: raw.name, createdAt: raw.createdAt,
    sources: sources as CalibrationSource[], overrides: Object.fromEntries(overrides) as Record<string, number>,
    ...(raw.lastUsedAt !== undefined && { lastUsedAt: raw.lastUsedAt }),
  };
}

function decodeSource(raw: unknown): CalibrationSource | undefined {
  if (!isObject(raw) || !isString(raw.sessionUid) || !isString(raw.weekendId)) return undefined;
  if (!isInteger(raw.feedCar) || !isInteger(raw.car) || !isInteger(raw.firstLap)) return undefined;
  if (!Array.isArray(raw.excludedLaps) || !raw.excludedLaps.every(isInteger)) return undefined;
  return {
    sessionUid: raw.sessionUid as SessionUid, weekendId: raw.weekendId, feedCar: raw.feedCar as CarId, car: raw.car as CarId,
    firstLap: raw.firstLap, excludedLaps: [...raw.excludedLaps] as number[],
  };
}
