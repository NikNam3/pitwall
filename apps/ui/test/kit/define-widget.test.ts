import { describe, expect, it } from 'vitest';
import { lapsFold } from '../../src/kit/folds.ts';
import { declareWidget, folded, topic } from '../../src/kit/define-widget.ts';
import defineWidgetSource from '../../src/kit/define-widget.ts?raw';
import optionsSource from '../../src/kit/options.ts?raw';

const sizes = { compact: { minCols: 28, minRows: 4 } };
const data = { session: topic('session.info') };

describe('declareWidget', () => {
  it('returns a declaration that keeps name, title, data and sizes', () => {
    const w = declareWidget({ name: 'undercut-card', title: 'Undercut', data, sizes });
    expect(w.name).toBe('undercut-card');
    expect(w.title).toBe('Undercut');
    expect(w.data).toBe(data);
    expect(w.sizes).toEqual(sizes);
  });
  it('accepts kebab-case names with digits', () => {
    expect(() => declareWidget({ name: 'tyre-temps-2', title: 'T', data, sizes })).not.toThrow();
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes })).not.toThrow();
  });
  it.each(['UndercutCard', 'undercut_card', 'undercut card', 'Undercut-card', '-undercut', 'undercut-', 'undercut--card', '', '2fast'])(
    'throws for the name %j, which is not kebab-case', (name) => {
      expect(() => declareWidget({ name, title: 'T', data, sizes })).toThrow();
    });
  it('throws when a size mode has minCols below 1', () => {
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: { compact: { minCols: 0, minRows: 4 } } })).toThrow();
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: { a: { minCols: 10, minRows: 4 }, b: { minCols: -3, minRows: 4 } } })).toThrow();
  });
  it('throws when there are no sizes', () => {
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: {} })).toThrow();
  });
});

describe('topic and folded record plain data for the generator and inspector', () => {
  it('topic records name, kind "state" and no params when none are given', () => {
    const d = topic('session.info');
    expect(d).toMatchObject({ topic: 'session.info', kind: 'state' });
    expect(d.params).toBeUndefined();
  });
  it('topic records the params function itself', () => {
    const params = () => ({ carId: 3 }) as never;
    expect(topic('car.detail', params).params).toBe(params);
    expect(topic('car.detail', params)).toMatchObject({ topic: 'car.detail', kind: 'state' });
  });
  it('folded records name, kind "folded", the fold and the params function', () => {
    const d = folded('laps', lapsFold);
    expect(d).toMatchObject({ topic: 'laps', kind: 'folded' });
    expect(d.fold).toBe(lapsFold);
    expect(d.params).toBeUndefined();
    const params = () => ({}) as never;
    expect(folded('laps', lapsFold, params).params).toBe(params);
  });
  it('is plain data apart from the functions: no class instances', () => {
    expect(Object.getPrototypeOf(topic('session.info'))).toBe(Object.prototype);
    expect(Object.getPrototypeOf(folded('laps', lapsFold))).toBe(Object.prototype);
  });
});

describe('Node-importable modules', () => {
  it.each([['define-widget.ts', defineWidgetSource], ['options.ts', optionsSource]])('%s imports nothing from Svelte or the DOM', (_file, src) => {
    expect(src).not.toMatch(/from\s+['"]svelte/);
    expect(src).not.toMatch(/\.svelte['"]/);
    expect(src).not.toMatch(/\b(document|window|navigator|HTMLElement)\b/);
  });
});
