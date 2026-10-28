import { describe, expect, it } from 'vitest';
import { MAX_WINDOWS, isAllowedOpenPath, parseEnsureWindows } from '../src/ipc-validate.ts';

const g = { screen: 0, x: 0, y: 30, width: 960, height: 1050 };

describe('parseEnsureWindows', () => {
  it('accepts a valid list unchanged', () => {
    const list = [{ id: 'strategy', geometry: g }, { id: 'car' }];
    expect(parseEnsureWindows(list)).toEqual(list);
  });

  it('accepts an empty list', () => {
    expect(parseEnsureWindows([])).toEqual([]);
  });

  it.each([[undefined], [null], ['x'], [{}], [42]])('rejects a non-array (%j)', (raw) => {
    expect(parseEnsureWindows(raw)).toBeUndefined();
  });

  it.each([[{}], [{ id: '' }], [{ id: 3 }], ['a'], [null]])('rejects an element without a non-empty string id (%j)', (el) => {
    expect(parseEnsureWindows([el])).toBeUndefined();
  });

  it.each([
    ['NaN x', { ...g, x: Number.NaN }],
    ['Infinity y', { ...g, y: Number.POSITIVE_INFINITY }],
    ['zero width', { ...g, width: 0 }],
    ['negative height', { ...g, height: -5 }],
    ['string width', { ...g, width: '960' }],
    ['not an object', 'big'],
  ])('rejects invalid geometry: %s', (_n, geometry) => {
    expect(parseEnsureWindows([{ id: 'a', geometry }])).toBeUndefined();
  });

  it('rejects duplicate ids', () => {
    expect(parseEnsureWindows([{ id: 'a' }, { id: 'a' }])).toBeUndefined();
  });

  it('allows MAX_WINDOWS (16) windows and rejects more', () => {
    expect(MAX_WINDOWS).toBe(16);
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}` }));
    expect(parseEnsureWindows(make(16))).toHaveLength(16);
    expect(parseEnsureWindows(make(17))).toBeUndefined();
  });
});

describe('isAllowedOpenPath', () => {
  const root = '/home/u/pitwall';

  it('is false outside dev, whatever the path', () => {
    expect(isAllowedOpenPath(root, `${root}/apps/x.ts`, false)).toBe(false);
  });

  it('is true in dev for an absolute path inside the repo root', () => {
    expect(isAllowedOpenPath(root, `${root}/apps/ui/src/a.ts`, true)).toBe(true);
    expect(isAllowedOpenPath(root, `${root}/apps/../packages/b.ts`, true)).toBe(true);
  });

  it('is false in dev for paths outside the root, including via ..', () => {
    expect(isAllowedOpenPath(root, '/etc/passwd', true)).toBe(false);
    expect(isAllowedOpenPath(root, `${root}/../etc`, true)).toBe(false);
    expect(isAllowedOpenPath(root, `${root}/apps/../../etc`, true)).toBe(false);
  });

  it('is false for a sibling directory sharing the root as a name prefix', () => {
    expect(isAllowedOpenPath(root, `${root}-evil/x`, true)).toBe(false);
  });

  it('is false in dev for relative paths and non-strings', () => {
    expect(isAllowedOpenPath(root, 'apps/x.ts', true)).toBe(false);
    expect(isAllowedOpenPath(root, undefined, true)).toBe(false);
    expect(isAllowedOpenPath(root, 7, true)).toBe(false);
  });
});
