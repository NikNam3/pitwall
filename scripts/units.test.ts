import { describe, expect, it } from 'vitest';
import { topicPrefix } from './units.ts';

describe('topicPrefix', () => {
  it.each([
    ['undercut-card', 'undercutCard'],
    ['rejoin', 'rejoin'],
    ['pit-loss-model', 'pitLossModel'],
    ['a-b-c', 'aBC'],
    ['feed-status', 'feedStatus'],
    ['tyre2-wear', 'tyre2Wear'],
  ])('%s -> %s', (unit, prefix) => {
    expect(topicPrefix(unit)).toBe(prefix);
  });
});
