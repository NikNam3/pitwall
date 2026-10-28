// spec 3.4 / 10.2, acceptance criterion 3
import { expect, it } from 'vitest';
import { describeWithFixture, FIXTURES, type FixtureName } from '../../../../test-support/fixtures.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';

const names = Object.keys(FIXTURES) as FixtureName[];
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
  expect(names).toHaveLength(3);
  expect([...hashes.keys()].sort()).toEqual([...names].sort());
  expect(new Set(hashes.values()).size).toBe(3);
});
