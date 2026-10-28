import { describe, expect, it } from 'vitest';
import type { FeedId, Insight } from '@pitwall/domain';
import { InsightBook } from '../../src/index.ts';

const ins = (key: string): Insight => ({ key, severity: 'advisory', category: 'feed', feedId: 'f1' as FeedId, kind: key, params: {}, raisedAt: 0 });

describe('InsightBook', () => {
  it('raises once per key while the condition holds', () => {
    const b = new InsightBook();
    expect(b.apply('src', [ins('feed.stale')], 1000)).toEqual([{ type: 'raised', insight: { ...ins('feed.stale'), raisedAt: 1000 } }]);
    expect(b.apply('src', [ins('feed.stale')], 2000)).toEqual([]);
    expect(b.apply('src', [ins('feed.stale'), ins('feed.stale')], 2500)).toEqual([]);
    expect(b.active.map((i) => i.key)).toEqual(['feed.stale']);
  });
  it('resolves a key absent from current and re-raises it later', () => {
    const b = new InsightBook();
    b.apply('src', [ins('k')], 1000);
    expect(b.apply('src', [], 3000)).toEqual([{ type: 'resolved', key: 'k', at: 3000 }]);
    expect(b.active).toEqual([]);
    expect(b.apply('src', [ins('k')], 4000)).toEqual([{ type: 'raised', insight: { ...ins('k'), raisedAt: 4000 } }]);
  });
  it('tracks sources independently', () => {
    const b = new InsightBook();
    b.apply('a', [ins('x')], 1);
    expect(b.apply('b', [], 2)).toEqual([]);
    expect(b.active.map((i) => i.key)).toEqual(['x']);
  });
  it('orders changes deterministically: resolutions in raise order, then raises in current order', () => {
    const b = new InsightBook();
    b.apply('s', [ins('b'), ins('a')], 1);
    expect(b.apply('s', [ins('d'), ins('c')], 2)).toEqual([
      { type: 'resolved', key: 'b', at: 2 }, { type: 'resolved', key: 'a', at: 2 },
      { type: 'raised', insight: { ...ins('d'), raisedAt: 2 } }, { type: 'raised', insight: { ...ins('c'), raisedAt: 2 } },
    ]);
    expect(b.active.map((i) => i.key)).toEqual(['d', 'c']);
  });
});
