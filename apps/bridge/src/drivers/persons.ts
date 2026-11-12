// The person files (C62c, SP4.3a spec 4): `<data dir>/drivers/<person>.json`, user-authored through the driver-profile
// uiActions and the source of truth (not a cache). Written atomically; a file that is not a person is skipped with one
// warning. The lock `drivers/.lock` makes the running bridge the files' only writer (P3).
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { CarId, DriverLink, DriverPerson, SessionRef, SessionUid } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';

export const driversDir = (root: string): string => join(root, 'drivers');
const personPath = (root: string, person: string): string => join(driversDir(root), `${person}.json`);
export const lockPath = (root: string): string => join(driversDir(root), '.lock');

/** A person id: kebab-case, so it is a safe file name. */
export const isPersonId = (id: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

/** Every person file under `<root>/drivers/`, by id; one that is not a person of its file name is skipped with a warning. */
export function loadPersons(root: string, log: Logger): DriverPerson[] {
  mkdirSync(driversDir(root), { recursive: true });
  const persons: DriverPerson[] = [];
  for (const file of readdirSync(driversDir(root)).filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort()) {
    const path = join(driversDir(root), file);
    const parsed = parseJson(readText(path) ?? '');
    const person = parsed.ok ? decodePerson(parsed.value) : undefined;
    if (person === undefined || `${person.id}.json` !== file) {
      log.warn({ path }, 'not a driver person (or not of its file name): skipped');
      continue;
    }
    persons.push(person);
  }
  return persons;
}

export function writePerson(root: string, person: DriverPerson): void {
  mkdirSync(driversDir(root), { recursive: true });
  writeAtomic(personPath(root, person.id), `${JSON.stringify(person, null, 2)}\n`);
}

/**
 * Takes the lock `drivers/.lock` (holding this process's pid); throws, naming the lock, while another live process holds
 * it. A lock left by a process that is gone is taken over.
 */
export function takeLock(root: string): () => void {
  mkdirSync(driversDir(root), { recursive: true });
  const path = lockPath(root);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number.parseInt(readText(path) ?? '', 10);
      if (Number.isInteger(holder) && isAlive(holder)) break;
      rmSync(path, { force: true });
    }
  }
  throw new Error(`the driver profiles are held by another process (${path}): edit them through the running bridge`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Whether two refs name the same stored session (C60's key). */
export const sameSession = (a: SessionRef, b: SessionRef): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.feedCar === b.feedCar;

/** Whether two links are the same link. */
export const sameLink = (a: DriverLink, b: DriverLink): boolean =>
  a.kind === 'nameAndNumber'
    ? b.kind === 'nameAndNumber' && a.name === b.name && a.raceNumber === b.raceNumber
    : b.kind === 'slot' && sameSession(a.session, b.session) && a.carId === b.carId;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isInteger = (v: unknown): v is number => Number.isInteger(v);

export function decodeSessionRef(raw: unknown): SessionRef | undefined {
  if (!isObject(raw) || !isString(raw.sessionUid) || !isString(raw.weekendId) || !isInteger(raw.feedCar)) return undefined;
  return { sessionUid: raw.sessionUid as SessionUid, weekendId: raw.weekendId, feedCar: raw.feedCar as CarId };
}

function decodeLink(raw: unknown): DriverLink | undefined {
  if (!isObject(raw)) return undefined;
  if (raw.kind === 'nameAndNumber') return isString(raw.name) && isInteger(raw.raceNumber) ? { kind: 'nameAndNumber', name: raw.name, raceNumber: raw.raceNumber } : undefined;
  if (raw.kind !== 'slot' || !isInteger(raw.carId)) return undefined;
  const session = decodeSessionRef(raw.session);
  return session === undefined ? undefined : { kind: 'slot', session, carId: raw.carId as CarId };
}

/** A person file's content rebuilt from its known fields; `undefined` when it is not a person (a hand edit may break one). */
function decodePerson(raw: unknown): DriverPerson | undefined {
  if (!isObject(raw) || !isString(raw.id) || !isPersonId(raw.id) || !isString(raw.displayName)) return undefined;
  if (!Array.isArray(raw.links) || !Array.isArray(raw.excluded) || !isObject(raw.overrides)) return undefined;
  const links = raw.links.map(decodeLink);
  const excluded = raw.excluded.map(decodeSessionRef);
  if (links.some((l) => l === undefined) || excluded.some((e) => e === undefined)) return undefined;
  const overrides = Object.entries(raw.overrides);
  if (overrides.some(([, v]) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
  return {
    id: raw.id, displayName: raw.displayName, links: links as DriverLink[], excluded: excluded as SessionRef[],
    overrides: Object.fromEntries(overrides) as Record<string, number>,
  };
}
