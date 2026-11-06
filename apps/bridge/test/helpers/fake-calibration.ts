// A fake of the calibration store's slice a feed pipeline uses (C62a, spec 3.3): `preselect`, `snapshotOf` and
// `markUsed`, over sets held in memory. No data dir, no priors store (C84): the entries are passed explicitly.
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { PriorsEntries, PriorsSnapshot } from '@pitwall/domain';
import type { CalibrationStore } from '../../src/calibration/store.ts';

export type FakeSet = { trackId: number; id: string; name: string; sources: number; entries: PriorsEntries };

/** The slice of the calibration store a feed pipeline is given. */
export type PipelineCalibration = Pick<CalibrationStore, 'preselect' | 'snapshotOf' | 'markUsed'>;

/** The fingerprint of a set's entries: equal entries, equal fingerprint (as the store's `entriesFingerprint`). */
const fingerprintOf = (entries: PriorsEntries): string => createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);

/**
 * The fake store: `preselect` gives the snapshot of the track's first set (none without one), `snapshotOf` the set's
 * snapshot from its current entries, `markUsed` only records its call. `snapshotNow` is `snapshotOf` without a recorded
 * call; `edit` changes a set's entries, as a calibration edit does between runs.
 */
export function fakeCalibration(sets: readonly FakeSet[]) {
  const held = sets.map((set) => ({ ...set }));
  const find = (trackId: number, setId: string): FakeSet => {
    const set = held.find((s) => s.trackId === trackId && s.id === setId);
    if (set === undefined) throw new Error(`no calibration set ${setId} on track ${trackId}`);
    return set;
  };
  const snapshotNow = (trackId: number, setId: string): PriorsSnapshot => {
    const set = find(trackId, setId);
    return { fingerprint: fingerprintOf(set.entries), setId: set.id, setName: set.name, sources: set.sources, entries: set.entries };
  };
  const snapshotOf = vi.fn(snapshotNow);
  const preselect = vi.fn((trackId: number): PriorsSnapshot | null => {
    const first = held.find((s) => s.trackId === trackId);
    return first === undefined ? null : snapshotNow(trackId, first.id);
  });
  const markUsed = vi.fn((_trackId: number, _setId: string, _at: string): void => {});
  const store: PipelineCalibration = { preselect, snapshotOf, markUsed };
  return {
    store,
    preselect,
    snapshotOf,
    markUsed,
    snapshotNow,
    edit: (trackId: number, setId: string, entries: PriorsEntries): void => {
      find(trackId, setId).entries = entries;
    },
  };
}
