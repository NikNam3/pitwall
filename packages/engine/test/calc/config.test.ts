// Config for calculators (spec 7.3): a feature declares a key with defaults, the engineer overrides some of them, a
// calculator reads the result from its `EngineView`, which the scheduler fills from its input.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineConfig, type ConfigKey, type EngineView } from '../../src/index.ts';
import { input, quick, sched } from '../support/scheduler.ts';

const viewWith = (config: EngineView['config']): EngineView => ({ config }) as EngineView;

const tyres = defineConfig('tyres.wear', { warnAt: 70, label: 'wear', strict: false });

describe('defineConfig', () => {
  it('carries the key and the defaults', () => {
    expect(tyres.key).toBe('tyres.wear');
    expect(tyres.defaults).toEqual({ warnAt: 70, label: 'wear', strict: false });
  });
  it('read gives the defaults when the view has no section for the key', () => {
    expect(tyres.read(viewWith({}))).toEqual({ warnAt: 70, label: 'wear', strict: false });
    expect(tyres.read(viewWith({ 'other.key': { warnAt: 1 } }))).toEqual({ warnAt: 70, label: 'wear', strict: false });
  });
  it('read merges the view over the defaults, field by field', () => {
    expect(tyres.read(viewWith({ 'tyres.wear': { warnAt: 55 } }))).toEqual({ warnAt: 55, label: 'wear', strict: false });
    expect(tyres.read(viewWith({ 'tyres.wear': { warnAt: 55, label: 'grip', strict: true } }))).toEqual({ warnAt: 55, label: 'grip', strict: true });
  });
  it('read gives a falsy override as it is, not the default', () => {
    expect(tyres.read(viewWith({ 'tyres.wear': { warnAt: 0, label: '', strict: false } }))).toEqual({ warnAt: 0, label: '', strict: false });
  });
  it('read never hands out the defaults object, and what it returns does not change them', () => {
    const read = tyres.read(viewWith({}));
    expect(read).not.toBe(tyres.defaults);
    (read as { warnAt: number }).warnAt = 1;
    expect(tyres.read(viewWith({}))).toEqual({ warnAt: 70, label: 'wear', strict: false });
  });
  it('is typed by the defaults', () => {
    expectTypeOf(tyres).toMatchTypeOf<ConfigKey<{ warnAt: number; label: string; strict: boolean }>>();
    expectTypeOf(tyres.read(viewWith({}))).toEqualTypeOf<{ warnAt: number; label: string; strict: boolean }>();
    // @ts-expect-error a name the defaults do not declare
    void tyres.read(viewWith({})).nope;
  });
});

describe('EngineView.config', () => {
  it('is read-only', () => {
    expectTypeOf<EngineView['config']>().toMatchTypeOf<Readonly<Record<string, Readonly<Record<string, number | string | boolean>>>>>();
    const view = viewWith({ k: { a: 1 } });
    // @ts-expect-error the config is fixed for the run
    view.config['k']!.a = 2;
  });
});

describe('Scheduler: config', () => {
  const probe = (config?: EngineView['config']) => {
    const s = sched([quick('c', { compute: (view) => tyres.read(view) })]);
    return s.run(input(0, ['timing'], undefined, undefined, config)).outputs.get('c');
  };
  it('passes the input config to the views of the calculators', () => {
    expect(probe({ 'tyres.wear': { warnAt: 40 } })).toEqual({ warnAt: 40, label: 'wear', strict: false });
  });
  it('an input without a section for the key leaves the calculator the defaults', () => {
    expect(probe()).toEqual({ warnAt: 70, label: 'wear', strict: false });
  });
  it('every frame carries the config of its input', () => {
    const s = sched([quick('c', { compute: (view) => tyres.read(view).warnAt })]);
    expect(s.run(input(0, ['timing'], undefined, undefined, { 'tyres.wear': { warnAt: 1 } })).outputs.get('c')).toBe(1);
    expect(s.run(input(1, ['timing'], undefined, undefined, { 'tyres.wear': { warnAt: 2 } })).outputs.get('c')).toBe(2);
  });
  it('insights see the same config as compute', () => {
    const seen: number[] = [];
    const s = sched([quick('c', { insights: (_out, _prev, view) => { seen.push(tyres.read(view).warnAt); return []; } })]);
    s.run(input(0, ['timing'], undefined, undefined, { 'tyres.wear': { warnAt: 9 } }));
    expect(seen).toEqual([9]);
  });
});
