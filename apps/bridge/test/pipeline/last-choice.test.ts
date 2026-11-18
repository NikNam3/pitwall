// The team's last confirmed choice (SP4.3e spec §4.2, Task 7a-1; C62, C70): bridge user state in
// `PITWALL_DATA_DIR/basis/<team>.json`, per track; written atomically; a missing file reads `undefined`, a corrupt one
// `undefined` with a warning (C3). Every test owns a temporary data dir (C84), never the real one.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
import type { LastChoice } from '../../src/pipeline/last-choice-types.ts';

const TEAM = 0;
const OTHER_TEAM = 1;
const AUSTIN = 15;
const MONZA = 11;

const dirs: string[] = [];
const dataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-last-choice-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const choice = (trackId: number, at: string): LastChoice => ({
  trackId,
  basis: {
    practice: { refs: [{ sessionUid: '100', weekendId: '7' }, { sessionUid: '101', weekendId: '7' }], at },
    qualifying: { ref: { sessionUid: '102', weekendId: '7' }, at },
  },
  plan: { id: 'texas-morning', at },
});

const warnLog = () => ({ warn: vi.fn() });

describe('the last choice store (C62, C70)', () => {
  it('write then read round-trips', () => {
    const dir = dataDir();
    const log = warnLog();
    const store = createLastChoiceStore(dir, log);
    const austin = choice(AUSTIN, '2026-11-18T09:40:00.000Z');
    const monza: LastChoice = { ...choice(MONZA, '2026-11-10T20:00:00.000Z'), basis: { practice: { refs: [], at: '2026-11-10T20:00:00.000Z' }, qualifying: { ref: null, at: '2026-11-10T20:00:00.000Z' } }, plan: { id: null, at: '2026-11-10T20:00:00.000Z' } };
    store.write(TEAM, austin);
    store.write(TEAM, monza);
    expect(store.read(TEAM, AUSTIN)).toEqual(austin);
    expect(store.read(TEAM, MONZA)).toEqual(monza);
    expect(existsSync(join(dir, 'basis', `${TEAM}.json`))).toBe(true);
    // A fresh store over the same dir reads the same file.
    expect(createLastChoiceStore(dir, log).read(TEAM, AUSTIN)).toEqual(austin);
    // A later write of a track replaces its choice; another team's file is its own.
    const later = choice(AUSTIN, '2026-11-18T17:30:00.000Z');
    store.write(TEAM, later);
    expect(store.read(TEAM, AUSTIN)).toEqual(later);
    expect(store.read(OTHER_TEAM, AUSTIN)).toBeUndefined();
    // Atomic write: no temp file left behind.
    expect(readdirSync(join(dir, 'basis'))).toEqual([`${TEAM}.json`]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a missing file reads undefined', () => {
    const log = warnLog();
    const store = createLastChoiceStore(dataDir(), log);
    expect(store.read(TEAM, AUSTIN)).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a corrupt file reads undefined with a warning (C3)', () => {
    const dir = dataDir();
    mkdirSync(join(dir, 'basis'), { recursive: true });
    writeFileSync(join(dir, 'basis', `${TEAM}.json`), '{ not json');
    writeFileSync(join(dir, 'basis', `${OTHER_TEAM}.json`), JSON.stringify({ [AUSTIN]: { trackId: AUSTIN, basis: 'nope' } }));
    const log = warnLog();
    const store = createLastChoiceStore(dir, log);
    expect(store.read(TEAM, AUSTIN)).toBeUndefined();
    expect(store.read(OTHER_TEAM, AUSTIN)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
