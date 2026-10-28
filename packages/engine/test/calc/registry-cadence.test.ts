import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, RegistryError, type Cadence, type Calculator } from '../../src/index.ts';

const calc = (id: string, cadence: Cadence): Calculator => ({ kind: 'quick', id, reads: ['timing'], cadence, compute: () => id });

describe('CalculatorRegistry cadence validation', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects { hz: %s } and names the calculator', (hz) => {
    const build = () => CalculatorRegistry.build([calc('ok', 'frame'), calc('slow', { hz })]);
    expect(build).toThrow(RegistryError);
    expect(build).toThrow(/calculator "slow" has cadence hz/);
    try { build(); } catch (e) { expect((e as RegistryError).reason).toBe('invalidCadence'); expect((e as RegistryError).ids).toEqual(['slow']); }
  });
  it('accepts a fractional rate', () => {
    expect(CalculatorRegistry.build([calc('slow', { hz: 0.5 })]).order.map((c) => c.id)).toEqual(['slow']);
  });
});
