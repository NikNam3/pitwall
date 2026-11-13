// `pit-losses` (spec 4.3, 4.4, 5): the analysis that publishes `pitLosses.track` from `pit-loss`'s output (C42, C56).
// `pit-loss` decides every judgement (each condition's blend, its source and parts, each stop's loss and use, C43);
// this analysis carries them to the topic as they are: per condition the loss, the median stationary time, the session's
// stops it rests on and the source with its parts; this session's stops in lap order with car, lap, condition, loss,
// stationary time and use. It reads only `{ calculator: 'pit-loss' }` (C41): every test computes through the guarded
// view. Guarded-view and behaviour-table completeness (C41, C44) come from the generic registry tests.
import { carId, known, unknown, type PitLossEstimate, type PitLossStop } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { engineView } from '../../../../test-support/builders/index.ts';
import { PIT_LOSS, type PitLossOutput } from '../../src/pit-loss/index.ts';
import { pitLossesCalculator } from '../../src/pit-losses/calculator.ts';
import { PIT_LOSSES, type PitLossesOutput } from '../../src/pit-losses/index.ts';

/** A view whose only upstream output is `pit-loss`'s `upstream`. */
const viewOf = (upstream: PitLossOutput): EngineView => engineView({ outputs: new Map([[PIT_LOSS, upstream]]) });

/** `compute` through the guarded view: a read the analysis does not declare throws (C41). */
const compute = (view: EngineView): PitLossesOutput =>
  pitLossesCalculator.compute(guardedView(view, pitLossesCalculator.reads, { unit: PIT_LOSSES })) as PitLossesOutput;

/** A `pit-loss` estimate with no stop and no prior. */
const none: PitLossEstimate = {
  lossMs: unknown('insufficientData'),
  inLapShare: known(0.26, 0),
  stationaryMedianMs: unknown('insufficientData'),
  sessionStops: 0,
  source: { kind: 'default', note: 'no calibration and no track default', sessionShare: 0, parts: 'no stops' },
};

describe('pit-losses', () => {
  it('per condition loss, parts and source from pit-loss', () => {
    // green: two stops blended with the calibration (share 1/2, not past half); VSC: three stops, measured this session;
    // SC: no stop, the track file's default alone
    const conditions: PitLossOutput['conditions'] = {
      green: {
        lossMs: known(22_000, 1_000_000),
        inLapShare: known(0.16, 1_000_000),
        stationaryMedianMs: known(2_500, 990_000),
        sessionStops: 2,
        source: { kind: 'calibration', setName: 'Zandvoort dry', sources: 3, sessionShare: 0.5, parts: '2 stops + calibration' },
      },
      vsc: {
        lossMs: known(13_000, 1_200_000),
        inLapShare: known(0.2, 1_200_000),
        stationaryMedianMs: known(2_600, 1_190_000),
        sessionStops: 3,
        source: { kind: 'session', sessionShare: 0.6, parts: '3 stops + calibration' },
      },
      sc: {
        lossMs: known(11_000, 0),
        inLapShare: known(0.26, 0),
        stationaryMedianMs: unknown('insufficientData'),
        sessionStops: 0,
        source: { kind: 'default', note: 'pit lane length × limiter, F1 25 track guide', sessionShare: 0, parts: 'track default' },
      },
    };
    const out = compute(viewOf({ conditions, stops: [] }));
    expect(out.conditions).toEqual(conditions);
    expect(out.conditions.green.source).toEqual({ kind: 'calibration', setName: 'Zandvoort dry', sources: 3, sessionShare: 0.5, parts: '2 stops + calibration' });
    expect(out.conditions.vsc.source).toMatchObject({ kind: 'session', parts: '3 stops + calibration' });
    expect(out.conditions.sc).toMatchObject({ lossMs: { known: true, value: 11_000 }, sessionStops: 0, source: { kind: 'default', parts: 'track default' } });
  });

  it("this session's stops in lap order with car, condition, loss, stationary, use", () => {
    // pit-loss gives every car's stops in lap order: a used green stop, a VSC stop without a clean reference, and a
    // stop-go served in the pit lane (R12), whose loss stays known but counts for nothing
    const stops: PitLossStop[] = [
      { carId: carId(4), lap: 10, condition: 'green', lossMs: known(24_000, 900_000), stationaryMs: 2_400, use: 'used' },
      { carId: carId(0), lap: 12, condition: 'vsc', lossMs: unknown('insufficientData'), stationaryMs: 2_700, use: 'noReference' },
      { carId: carId(9), lap: 12, condition: 'green', lossMs: known(25_500, 1_080_000), stationaryMs: 2_600, use: 'used' },
      { carId: carId(2), lap: 15, condition: 'green', lossMs: known(36_000, 1_350_000), stationaryMs: 12_400, use: 'penalty' },
    ];
    const out = compute(viewOf({ conditions: { green: none, vsc: none, sc: none }, stops }));
    expect(out.stops).toEqual(stops);
    expect(out.stops.map((s) => s.lap)).toEqual([10, 12, 12, 15]);
    expect(out.stops.map((s) => [s.carId, s.condition, s.use])).toEqual([
      [carId(4), 'green', 'used'],
      [carId(0), 'vsc', 'noReference'],
      [carId(9), 'green', 'used'],
      [carId(2), 'green', 'penalty'],
    ]);
  });

  it('no stop yet: every condition as pit-loss gives it, and no stops', () => {
    const out = compute(viewOf({ conditions: { green: none, vsc: none, sc: none }, stops: [] }));
    expect(out).toEqual({ conditions: { green: none, vsc: none, sc: none }, stops: [] });
  });
});
