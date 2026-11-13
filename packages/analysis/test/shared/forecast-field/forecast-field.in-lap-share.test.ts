// SP4.3b Task 11c (spec F8, cause 3; C43): the in-lap's share of a stop is `pit-loss`'s judgement, measured per session
// and blended with its config's prior; `forecast-field` fills `StartingPoint.track.pitLossMs.inLapShare` from it and
// keeps no share of its own (its config's `inLapLossShare` is removed).
import { known, unknown, type Known, type PitLosses, type StartingPoint, type TrackData } from '@pitwall/domain';
import { asOfNow, type AsOfView, type CalculatorId } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { zandvoortTrack } from '../../../../../test-support/track.ts';
import { PIT_LOSS, PIT_LOSS_CONFIG } from '../../../src/pit-loss/index.ts';
import { buildStartingPoint, FORECAST_FIELD_CONFIG } from '../../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

const g = generated();

/** The starting point at lap 6 with pit-loss's in-lap share `share` in every condition, on `track` (the support's by default). */
function buildWithShare(share: Known<number>, track?: AsOfView['track']): StartingPoint {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(6)[0]!)), track === undefined ? {} : { track });
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

  // SP4.3b Task 26 row 4 (spec F2, Q5 A; C62b): without pit-loss's estimate the stand-in is pit-loss's prior, the
  // track file's share where known, else pit-loss's config's
  it("forecast-field: the starting point's pitLossMs.inLapShare falls back to the track file's share (not the config's) when pit-loss has no estimate and the track's share is known", () => {
    const zandvoort = zandvoortTrack();
    const trackWith = (share: TrackData['defaults']['pitLossInLapShare']): AsOfView['track'] =>
      known({ ...zandvoort, defaults: { ...zandvoort.defaults, pitLossInLapShare: share } }, 0);
    const none = unknown('insufficientData');
    expect(buildWithShare(none, trackWith(known({ value: 0.02, source: 'test: F1 25 Texas' }, 0))).track.pitLossMs.inLapShare).toBeCloseTo(0.02, 9);
    // without the track's share: the config's, as before
    expect(buildWithShare(none, trackWith(unknown('notReceived'))).track.pitLossMs.inLapShare).toBeCloseTo(PIT_LOSS_CONFIG.defaults.inLapShare, 9);
    expect(buildWithShare(none, unknown('notApplicable')).track.pitLossMs.inLapShare).toBeCloseTo(PIT_LOSS_CONFIG.defaults.inLapShare, 9);
    // pit-loss's own estimate still wins over the track's
    expect(buildWithShare(known(0.11, 0), trackWith(known({ value: 0.02, source: 'test' }, 0))).track.pitLossMs.inLapShare).toBeCloseTo(0.11, 9);
  });
});
