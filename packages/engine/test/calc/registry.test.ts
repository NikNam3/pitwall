import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, RegistryError, type Calculator, type Dependency } from '../../src/index.ts';

const calc = (id: string, reads: Dependency[] = ['timing']): Calculator =>
  ({ kind: 'quick', id, reads, cadence: 'frame', compute: () => id });

describe('CalculatorRegistry', () => {
  it('orders dependencies before dependents', () => {
    const r = CalculatorRegistry.build([calc('c', [{ calculator: 'b' }]), calc('b', [{ calculator: 'a' }]), calc('a')]);
    expect(r.order.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  it('keeps input order among independent calculators', () => {
    const r = CalculatorRegistry.build([calc('z'), calc('y'), calc('x', [{ calculator: 'z' }])]);
    expect(r.order.map((c) => c.id)).toEqual(['z', 'y', 'x']);
  });
  it('get and dependentsOf', () => {
    const r = CalculatorRegistry.build([calc('a'), calc('b', [{ calculator: 'a' }]), calc('c', [{ calculator: 'a' }, 'laps'])]);
    expect(r.get('b')?.id).toBe('b');
    expect(r.get('nope')).toBeUndefined();
    expect(r.dependentsOf('a')).toEqual(['b', 'c']);
    expect(r.dependentsOf('c')).toEqual([]);
  });
  it('rejects a duplicate id and names it', () => {
    expect(() => CalculatorRegistry.build([calc('lapStats'), calc('lapStats')])).toThrow(RegistryError);
    expect(() => CalculatorRegistry.build([calc('lapStats'), calc('lapStats')])).toThrow(/duplicate calculator id "lapStats"/);
  });
  it('rejects an unknown calculator dependency and names both ids', () => {
    expect(() => CalculatorRegistry.build([calc('gaps', [{ calculator: 'miniSectors' }])]))
      .toThrow(/calculator "gaps" depends on unknown calculator "miniSectors"/);
  });
  it('rejects a cycle and names the ids on it', () => {
    const build = () => CalculatorRegistry.build([calc('a', [{ calculator: 'c' }]), calc('b', [{ calculator: 'a' }]), calc('c', [{ calculator: 'b' }]), calc('d')]);
    expect(build).toThrow(/dependency cycle: a -> c -> b -> a/);
    try { build(); } catch (e) { expect((e as RegistryError).reason).toBe('cycle'); expect((e as RegistryError).ids).toEqual(['a', 'c', 'b']); }
  });
});
