// @vitest-environment jsdom
// Panel staleness (kit/stale/panel-stale.svelte.ts): `staleForMs` is how long the most behind cell has been stale.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PanelStale } from '../../src/kit/stale/panel-stale.svelte.ts';
import PanelStaleProbe from './PanelStaleProbe.svelte';

afterEach(cleanup);
const panel = (): PanelStale => {
  let got: PanelStale | undefined;
  render(PanelStaleProbe, { onPanel: (p: PanelStale) => (got = p) });
  return got!;
};

describe('PanelStale.staleForMs', () => {
  it('is undefined while no cell reports', () => {
    expect(panel().staleForMs).toBeUndefined();
  });
  it('is the largest report, whatever the order they arrive in', () => {
    const p = panel();
    p.reportStale(Symbol('a'), 5);
    p.reportStale(Symbol('b'), 9);
    p.reportStale(Symbol('c'), 7);
    expect(p.staleForMs).toBe(9);
    const q = panel();
    q.reportStale(Symbol('a'), 9);
    q.reportStale(Symbol('b'), 5);
    expect(q.staleForMs).toBe(9);
  });
  it('a single report of 0 is 0, not undefined', () => {
    const p = panel();
    p.reportStale(Symbol('a'), 0);
    expect(p.staleForMs).toBe(0);
  });
  it('a cell that reports undefined is no longer counted; the next largest remains', () => {
    const p = panel();
    const a = Symbol('a');
    p.reportStale(a, 9);
    p.reportStale(Symbol('b'), 4);
    p.reportStale(a, undefined);
    expect(p.staleForMs).toBe(4);
  });
  it('when the only stale cell recovers, staleForMs is undefined again', () => {
    const p = panel();
    const a = Symbol('a');
    p.reportStale(a, 12);
    p.reportStale(a, undefined);
    expect(p.staleForMs).toBeUndefined();
  });
  it('a cell\'s new report replaces its old one', () => {
    const p = panel();
    const a = Symbol('a');
    p.reportStale(a, 12);
    p.reportStale(a, 3);
    expect(p.staleForMs).toBe(3);
  });
});
