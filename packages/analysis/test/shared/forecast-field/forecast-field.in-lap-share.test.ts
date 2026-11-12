// SP4.3b Task 11c (spec F8, cause 3; C43): the in-lap's share of a stop is `pit-loss`'s judgement, measured per session
// and blended with its config's prior; `forecast-field` fills `StartingPoint.track.pitLossMs.inLapShare` from it and
// keeps no share of its own (its config's `inLapLossShare` is removed).
import { known, type Known, type PitLosses, type StartingPoint } from '@pitwall/domain';
import { asOfNow, type CalculatorId } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { PIT_LOSS } from '../../../src/pit-loss/index.ts';
import { buildStartingPoint, FORECAST_FIELD_CONFIG } from '../../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

const g = generated();

/** The starting point at lap 6 with pit-loss's in-lap share `share` in every condition. */
function buildWithShare(share: Known<number>): StartingPoint {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(6)[0]!)));
  const outputs = new Map<CalculatorId, unknown>(upstreamOf(view, plainNoise(PARAMS.cars, [6, 7], view.at)));
  const pitLoss = outputs.get(PIT_LOSS) as PitLosses;
  const conditions = Object.fromEntries(Object.entries(pitLoss.conditions).map(([c, e]) => [c, { ...e, inLapShare: share }])) as PitLosses['conditions'];
  outputs.set(PIT_LOSS, { ...pitLoss, conditions });
  const sp = buildStartingPoint(view, outputs);
  if (!sp.known) throw new Error(`the starting point is unknown (${sp.reason})`);
  return sp.value;
}

describe('forecast-field: the in-lap share from pit-loss (SP4.3b Task 11c)', () => {
  // row 3
  it("forecast-field passes pit-loss's in-lap share into the starting point", () => {
    expect(buildWithShare(known(0.11, 0)).track.pitLossMs.inLapShare).toBeCloseTo(0.11, 9);
    expect(buildWithShare(known(0, 0)).track.pitLossMs.inLapShare).toBe(0);
    // the share is pit-loss's alone: forecast-field's config holds none
    expect(FORECAST_FIELD_CONFIG.defaults).not.toHaveProperty('inLapLossShare');
  });
});
