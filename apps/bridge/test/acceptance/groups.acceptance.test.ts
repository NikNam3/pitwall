// The groups together are exactly the old sets: every race recording of `fixtures/index.json` once, and the seven
// determinism recordings once, so splitting the files dropped no recording. No replay.
import { expect, it } from 'vitest';
import { FIXTURES } from '../../../../test-support/fixtures.ts';
import { DETERMINISM, DETERMINISM_GROUPS, RACE_GROUPS, RACES } from './groups.ts';

it('the race groups together are exactly the race recordings of fixtures/index.json not kept out of acceptance, each once', () => {
  expect(RACES.length).toBeGreaterThan(0);
  expect(RACES.every((r) => r in FIXTURES)).toBe(true);
  const grouped = Object.values(RACE_GROUPS).flat();
  expect(grouped).toHaveLength(new Set(grouped).size);
  expect([...grouped].sort()).toEqual([...RACES].sort());
});

it('the determinism groups together are exactly the seven determinism recordings, each once, at least two per group', () => {
  expect(DETERMINISM).toHaveLength(7);
  const grouped = Object.values(DETERMINISM_GROUPS).flat();
  expect(grouped).toHaveLength(new Set(grouped).size);
  expect([...grouped].sort()).toEqual([...DETERMINISM].sort());
  for (const group of Object.values(DETERMINISM_GROUPS)) expect(group.length).toBeGreaterThanOrEqual(2);
});
