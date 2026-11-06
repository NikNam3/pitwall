// `rain-outlook` (spec 3.3): the one judgement of "rain is coming" (C43). The first forecast sample with `offsetMin ≥ 0`
// and `rainPct ≥ rainPct` (config, C47), and whether it lies within `horizonMin`. No such sample is `notApplicable`, never
// a 0 (C3). Every test computes through the unit's guarded view (C41).
import { unknown, type ForecastSample } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { rainOutlookCalculator } from '../../src/rain-outlook/calculator.ts';
import { RAIN_OUTLOOK, RAIN_OUTLOOK_CONFIG, type RainOutlook } from '../../src/rain-outlook/index.ts';

/** A forecast sample `offsetMin` minutes ahead with `rainPct` % rain chance; the other fields as a dry sample has them. */
const sample = (offsetMin: number, rainPct: number): ForecastSample => ({
  offsetMin,
  weather: 'overcast',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});

/** `compute` over a session with this forecast, through the guarded view (C41); `config` overrides the unit's (C47). */
const outlook = (forecast: ForecastSample[], config: Partial<typeof RAIN_OUTLOOK_CONFIG.defaults> = {}, onRead?: (path: string) => void): RainOutlook =>
  rainOutlookCalculator.compute(
    guardedView(engineView({ session: { forecast }, config: { [RAIN_OUTLOOK_CONFIG.key]: config } }), rainOutlookCalculator.reads, {
      unit: RAIN_OUTLOOK,
      ...(onRead !== undefined && { onRead }),
    }),
  );

const AT_0_5_15 = [sample(0, 20), sample(5, 45), sample(15, 60)];

describe('rain-outlook', () => {
  it('1. no sample: firstRain notApplicable, withinHorizon false', () => {
    expect(outlook([])).toEqual({ firstRain: unknown('notApplicable'), withinHorizon: false });
  });

  it('2. samples at 0 (20 %), 5 (45 %), 15 (60 %) min: firstRain is the 5-min sample (index 1), within the horizon', () => {
    expect(outlook(AT_0_5_15)).toEqual({ firstRain: { known: true, value: { index: 1, offsetMin: 5, rainPct: 45 } }, withinHorizon: true });
  });

  it('3. the same samples out of order, plus one at -5 min with 90 %: the same answer (sorted by offsetMin, offsetMin < 0 ignored)', () => {
    const shuffled = [sample(15, 60), sample(-5, 90), sample(5, 45), sample(0, 20)];
    expect(outlook(shuffled)).toEqual({ firstRain: { known: true, value: { index: 1, offsetMin: 5, rainPct: 45 } }, withinHorizon: true });
  });

  it('4. first rain at 15 min: withinHorizon false by default (10 min); with horizonMin 20 it is true', () => {
    const later = [sample(0, 20), sample(5, 30), sample(15, 60)];
    const byDefault = outlook(later);
    expect(byDefault.firstRain).toEqual({ known: true, value: { index: 2, offsetMin: 15, rainPct: 60 } });
    expect(byDefault.withinHorizon).toBe(false);
    expect(outlook(later, { horizonMin: 20 }).withinHorizon).toBe(true);
  });

  it('5. a sample at exactly rainPct (40 %) counts; 39 % does not', () => {
    expect(RAIN_OUTLOOK_CONFIG.defaults.rainPct).toBe(40);
    expect(outlook([sample(5, 40)])).toEqual({ firstRain: { known: true, value: { index: 0, offsetMin: 5, rainPct: 40 } }, withinHorizon: true });
    expect(outlook([sample(5, 39)])).toEqual({ firstRain: unknown('notApplicable'), withinHorizon: false });
  });

  it('6. guarded view: reads only session', () => {
    expect(rainOutlookCalculator.id).toBe('rain-outlook');
    expect(rainOutlookCalculator.reads).toEqual(['session']);
    const paths: string[] = [];
    // computing through the guarded view throws on any undeclared read (C41); every read is of the live session or config
    expect(() => outlook(AT_0_5_15, {}, (p) => paths.push(p))).not.toThrow();
    expect(paths).toContain('live.session');
    expect(paths.filter((p) => !p.startsWith('live.session') && !p.startsWith('config') && p !== 'live')).toEqual([]);
  });
});
