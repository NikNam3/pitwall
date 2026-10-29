// @vitest-environment jsdom
// The corner block on a stale feed (spec 8.1, 6.4): its car fields dim through the kit's stale path and report to the panel.
import { cleanup, render } from '@testing-library/svelte';
import { known, type BandReading, type CarBands, type CarState, type Corners, type Known, type SessionTime, type TyreWear } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { role } from '../../theme/index.ts';
import CornerBlock from './CornerBlock.svelte';

afterEach(cleanup);

const T = (n: number) => n as SessionTime;
const k = <V>(v: V): Known<V> => known(v, T(0));
const four = <V>(f: (name: keyof Corners<unknown>) => V): Corners<V> => ({ fl: f('fl'), fr: f('fr'), rl: f('rl'), rr: f('rr') });
const rd = (v: number, over: Partial<BandReading> = {}): BandReading => ({ value: k(v), state: k('in'), band: { lo: 0, hi: 2000 }, outForFullLap: false, ...over });

/** Telemetry at `telemetryAt`, the car's newest update (lap data) at `newestAt`. */
const car = (telemetryAt: number, newestAt: number): CarState =>
  ({
    tyres: { corners: four(() => ({ surfaceTempC: k(98), carcassTempC: k(101), pressurePsi: k(23.1), wearPct: k(0) })) },
    condition: { brakes: four((n) => ({ tempC: k(n === 'fr' ? 1043 : 812), damagePct: k(0) })), engineTempC: k(112) },
    updatedAt: { telemetry: T(telemetryAt), lapData: T(newestAt) },
  }) as unknown as CarState;
const bands: CarBands = {
  tyres: four(() => ({ surfaceC: rd(98), carcassC: rd(101), pressurePsi: rd(23.1) })),
  brakesC: { ...four(() => rd(812)), fr: rd(1043, { state: k('above'), outForFullLap: true }) },
  engineC: rd(112),
};
const wear: TyreWear = {
  corners: four(() => ({ wearPct: k(18), ratePctPerLap: k(1.5), lapsToLimit: k(30) })),
  limitPct: 70, warnLaps: 3, gameLifeSpanLaps: k(25),
};

const show = (mode: 'compact' | 'full', telemetryAt: number, newestAt: number) =>
  render(InPanel, {
    component: CornerBlock as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { car: car(telemetryAt, newestAt), bands, wear }, options: {}, size: { mode, cols: 60, rows: 9, px: { width: 600, height: 200 }, dpr: 1 }, link: {} },
    cadenceMs: 50,
  });
const brake = (c: HTMLElement): HTMLElement => [...c.querySelectorAll('span')].find((s) => s.textContent?.includes('1043')) as HTMLElement;
const staleFor = (c: HTMLElement): string => c.querySelector('[data-testid="stale-for"]')?.textContent ?? '';

describe('CornerBlock: staleness', () => {
  it.each(['full', 'compact'] as const)('%s: a fresh critical brake is red and nothing is reported', (mode) => {
    const { container } = show(mode, 1000, 1100);
    expect(brake(container).style.color).toBe(role('critical'));
    expect(staleFor(container)).toBe('');
  });

  it.each(['full', 'compact'] as const)('%s: once telemetry falls behind, the brake is faint, not red, and the panel hears for how long', (mode) => {
    const { container } = show(mode, 1000, 31_000);
    expect(brake(container).style.color).toBe(role('textFaint'));
    expect(staleFor(container)).toBe('30000');
  });
});
