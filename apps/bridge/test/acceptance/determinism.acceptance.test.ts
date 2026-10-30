// spec 3.4 / 10.2, acceptance criterion 3
import { expect, it } from 'vitest';
import { describeWithFixture, type FixtureName } from '../../../../test-support/fixtures.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';

// User ruling 2026-10-30: the time trial is too special a case, and the two big races (raceSingaporeWet, raceZandvoortUidReuse) cost too long.
const names: FixtureName[] = ['raceSingapore', 'menuOnly', 'qualifyingSingapore', 'practiceZandvoortOnline', 'raceZandvoortOnline', 'practiceZandvoortUidReuse', 'lobbyOnly'];
const hashes = new Map<FixtureName, string>();
for (const name of names) {
  describeWithFixture(name, `determinism: ${name}`, (path) => {
    it('replaying twice gives an identical topic stream', async () => {
      const a = await topicStreamHash(path);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(await topicStreamHash(path)).toBe(a);
      hashes.set(name, a);
    });
  });
}
it('different recordings give different streams (the hash is not constant)', () => {
  // pinned: when a fixture was skipped or failed, `hashes` is short and this fails instead of passing vacuously
  expect(names).toHaveLength(7);
  expect([...hashes.keys()].sort()).toEqual([...names].sort());
  expect(new Set(hashes.values()).size).toBe(7);
});
