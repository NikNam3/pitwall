import { describe, expect, it, vi } from 'vitest';
import { lapsFold } from '../../src/kit/folds.ts';
import { declareWidget, folded, registerWidget, topic } from '../../src/kit/define-widget.ts';
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
  it('throws when a size mode has minRows below 1', () => {
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: { compact: { minCols: 28, minRows: 0 } } })).toThrow();
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: { a: { minCols: 10, minRows: 4 }, b: { minCols: 10, minRows: -1 } } })).toThrow();
  });
  it('throws when there are no sizes', () => {
    expect(() => declareWidget({ name: 'gaps', title: 'T', data, sizes: {} })).toThrow();
  });
});

// Review 7, R7-4: every call of a built lazy loader runs Vite's preload helper, which scans the whole page, so the
// registry imports a widget's component once for everyone that mounts it (the app's panels and the gallery's cells).
describe('registerWidget: one import of the component', () => {
  const decl = declareWidget({ name: 'gaps', title: 'Gaps', data, sizes });
  const loaded = { default: (() => undefined) as never };

  it('keeps the declaration', () => {
    expect(registerWidget(decl, () => Promise.resolve(loaded)).decl).toBe(decl);
  });

  it('imports nothing before the component is first asked for', () => {
    const load = vi.fn(() => Promise.resolve(loaded));
    registerWidget(decl, load);
    expect(load).not.toHaveBeenCalled();
  });

  it('imports the component on the first call and hands every later call the same promise', async () => {
    const load = vi.fn(() => Promise.resolve(loaded));
    const registered = registerWidget(decl, load);
    const first = registered.component();
    const later = [registered.component(), registered.component(), registered.component()];
    expect(load).toHaveBeenCalledTimes(1);
    for (const p of later) expect(p).toBe(first);
    expect(await first).toBe(loaded);
  });

  it('a call after the import has settled imports nothing again', async () => {
    const load = vi.fn(() => Promise.resolve(loaded));
    const registered = registerWidget(decl, load);
    await registered.component();
    await registered.component();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed import is not kept: the next call imports again, and that success is then the one import', async () => {
    // A chunk that failed to load (a dropped connection, a rebuilt bundle) must not stay failed until the page reloads.
    const failure = new Error('chunk failed to load');
    const load = vi.fn<() => Promise<typeof loaded>>().mockRejectedValueOnce(failure).mockResolvedValue(loaded);
    const registered = registerWidget(decl, load);
    await expect(registered.component()).rejects.toBe(failure);
    const retried = registered.component();
    expect(load).toHaveBeenCalledTimes(2);
    expect(await retried).toBe(loaded);
    expect(registered.component()).toBe(retried);
    await registered.component();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('callers waiting on a failing import all see its failure; a call after it imports again', async () => {
    const failure = new Error('chunk failed to load');
    const load = vi.fn<() => Promise<typeof loaded>>().mockRejectedValueOnce(failure).mockResolvedValue(loaded);
    const registered = registerWidget(decl, load);
    const waiting = [registered.component(), registered.component()];
    expect(load).toHaveBeenCalledTimes(1);
    for (const p of waiting) await expect(p).rejects.toBe(failure);
    expect(await registered.component()).toBe(loaded);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('each registration imports its own component', () => {
    const a = vi.fn(() => Promise.resolve(loaded));
    const b = vi.fn(() => Promise.resolve(loaded));
    registerWidget(decl, a).component();
    registerWidget(decl, b).component();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
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
