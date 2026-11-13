// `pit-loss` (spec 4.3, 4.4, 7): the time a stop costs per condition, from every car's stops of the session (TUM: in-lap
// + out-lap − 2 × the median of the car's `forPace` laps before the stop, the stationary time above the session's
// median removed and kept apart), blended with the prior: `view.priors`' `pitLoss.ms.<condition>`, else the track
// file's default (C62a, C62b). The blend `(n · sessionMedian + k · prior) / (n + k)` with `k` = `priorWeightStops` 2;
// the source is `session` once the session's share `n / (n + k)` is above half (spec 4.4). A quick calculator (C31).
// Guarded-view and behaviour-table completeness (C41, C44) come from the generic registry tests.
//
// Every stop here is on lap 10 or later with its three reference laps (laps 7–9) clean, so "the `referenceLaps` laps
// before the stop" and "the last `referenceLaps` `forPace` laps before it" agree; lap 1 of a race is never `forPace`.
import { carId, known, unknown, type LapRecord, type PitStopRecord, type PriorsSnapshot, type Ms, type TrackData } from '@pitwall/domain';
import type { EngineView, StoredSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { engineView, history, lap } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { pitLossCalculator } from '../../src/pit-loss/calculator.ts';
import { PIT_LOSS, PIT_LOSS_CONFIG, PIT_LOSS_PRIORS, type PitLossOutput } from '../../src/pit-loss/index.ts';

type Condition = PitStopRecord['flag'];

/** The reference lap time of every helper stop: its median is the reference. */
const REF_MS = 80_000;
/** The in-lap time of every helper stop. */
const IN_MS = 92_000;

/** A pit-stop record of car `car` that entered the pit lane on lap `lap`. */
const stopRecord = (car: number, lapNumber: number, o: { stationaryMs?: Ms; flag?: Condition; penaltyServed?: boolean } = {}): PitStopRecord => ({
  carId: carId(car),
  lap: lapNumber,
  pitLaneEntry: lapNumber * 90_000 - 5_000,
  pitLaneExit: lapNumber * 90_000 + 15_000,
  pitLaneTimeMs: 20_000,
  stationaryTimeMs: o.stationaryMs ?? 2_500,
  flag: o.flag ?? 'green',
  penaltyServed: o.penaltyServed ?? false,
  frame: lapNumber * 100 + 50,
});

/** One lap of car `car`: `lapNumber` taking `lapTimeMs`, with `over` (in-lap, out-lap, validity …). */
const lapOf = (car: number, lapNumber: number, lapTimeMs: Ms, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ carId: carId(car), lapNumber, lapTimeMs, frame: lapNumber * 100, ...over });

/**
 * A stop of car `car` on lap `lapNumber` with its laps: reference laps `refs` on the three laps before (clean), the in-lap
 * on `lapNumber` and the out-lap after. Without `inMs` and `outMs`, the in-lap is `IN_MS` and the out-lap makes the
 * TUM loss (before the stationary correction) `lossMs` over three `REF_MS` references.
 */
const stopWith = (
  car: number,
  o: { lap?: number; lossMs?: Ms; inMs?: Ms; outMs?: Ms; refs?: [Ms, Ms, Ms]; stationaryMs?: Ms; flag?: Condition; refsValid?: boolean; penaltyServed?: boolean },
): { laps: LapRecord[]; stop: PitStopRecord } => {
  const n = o.lap ?? 10;
  const refs = o.refs ?? [REF_MS, REF_MS, REF_MS];
  const inMs = o.inMs ?? IN_MS;
  const outMs = o.outMs ?? 2 * REF_MS + (o.lossMs ?? 0) - inMs;
  const neutralised = o.flag === 'vsc' ? { vscShare: 0.5 } : o.flag === 'sc' ? { scShare: 0.5 } : {};
  const valid = o.refsValid === false ? { valid: { lap: false, sectors: [false, false, false] as [boolean, boolean, boolean] } } : {};
  return {
    laps: [
      lapOf(car, n - 3, refs[0], valid),
      lapOf(car, n - 2, refs[1], valid),
      lapOf(car, n - 1, refs[2], valid),
      lapOf(car, n, inMs, { inLap: true, ...neutralised }),
      lapOf(car, n + 1, outMs, { outLap: true, ...neutralised }),
    ],
    stop: stopRecord(car, n, {
      ...(o.stationaryMs !== undefined && { stationaryMs: o.stationaryMs }),
      ...(o.flag !== undefined && { flag: o.flag }),
      ...(o.penaltyServed !== undefined && { penaltyServed: o.penaltyServed }),
    }),
  };
};

/** A race view of the given stops (laps and records merged), with the track file and priors given. */
const viewOf = (
  stops: { laps: LapRecord[]; stop: PitStopRecord }[],
  o: { track?: EngineView['track']; priors?: EngineView['priors'] } = {},
): EngineView =>
  engineView({
    history: history({ laps: stops.flatMap((s) => s.laps), pitStops: stops.map((s) => s.stop) }),
    ...(o.track !== undefined && { track: o.track }),
    ...(o.priors !== undefined && { priors: o.priors }),
  });

/** `compute` through the guarded view: a read the calculator does not declare throws (C41). */
const compute = (view: EngineView): PitLossOutput =>
  pitLossCalculator.compute(guardedView(view, pitLossCalculator.reads, { unit: PIT_LOSS })) as PitLossOutput;

/** A calibration snapshot with the pit loss `ms` for every condition. */
const snapshot = (ms: Ms): PriorsSnapshot => ({
  fingerprint: 'fp-zandvoort-dry',
  setId: 'zandvoort-dry',
  setName: 'Zandvoort dry',
  sources: 3,
  entries: { 'pitLoss.ms.green': known(ms, 0), 'pitLoss.ms.vsc': known(ms, 0), 'pitLoss.ms.sc': known(ms, 0) },
});

/** The priors aggregate's context: default config, no override. */
const ctx = { config: {}, overrides: {} };

/** A stored source of session `session`: car `car`'s stint from `firstLap`, the session's stops and every car's laps. */
const storedSource = (session: number, stops: { laps: LapRecord[]; stop: PitStopRecord }[], car: number, firstLap: number): StoredSource => ({
  source: { sessionUid: `${session}`, weekendId: 'w1', feedCar: carId(0), car: carId(car), firstLap, excludedLaps: [] },
  phase: { kind: 'race', format: 'grandPrix' },
  aiDifficulty: unknown('notReceived'),
  projection: history(),
  stint: { carId: carId(car), firstLap, lastLap: firstLap + 10, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 0, frame: firstLap * 100 },
  laps: stops.flatMap((s) => s.laps),
  pitStops: stops.map((s) => s.stop),
  // every car's laps of the session: the laps each stop's loss needs (StoredSource.sessionLaps, ruling R6)
  sessionLaps: stops.flatMap((s) => s.laps),
  track: unknown('notApplicable'),
});

describe('pit-loss', () => {
  it('TUM loss on a hand-built stop', () => {
    const out = compute(viewOf([stopWith(0, { inMs: 92_000, outMs: 95_000, refs: [80_000, 80_400, 80_200] })]));
    // 92 000 + 95 000 − 2 × median(80 000, 80 400, 80 200) = 187 000 − 160 400
    expect(out.stops).toEqual([
      { carId: carId(0), lap: 10, condition: 'green', lossMs: expect.objectContaining({ known: true, value: 26_600 }), stationaryMs: 2_500, use: 'used' },
    ]);
  });

  it('stationary above the median is removed and kept apart', () => {
    const quick = stopWith(0, { inMs: 92_000, outMs: 95_000, refs: [80_000, 80_400, 80_200], stationaryMs: 2_400 });
    const slow = stopWith(1, { inMs: 92_000, outMs: 95_000, refs: [80_000, 80_400, 80_200], stationaryMs: 5_400 });
    const out = compute(viewOf([quick, slow]));
    const byCar = (car: number) => out.stops.find((s) => s.carId === carId(car));
    // the session's median stationary time is 3 900: the slow stop's 1 500 above it are not the pit lane's loss
    expect(out.conditions.green.stationaryMedianMs).toMatchObject({ known: true, value: 3_900 });
    expect(byCar(0)).toMatchObject({ lossMs: { known: true, value: 26_600 }, stationaryMs: 2_400, use: 'used' });
    expect(byCar(1)).toMatchObject({ lossMs: { known: true, value: 25_100 }, stationaryMs: 5_400, use: 'used' });
  });

  it('a stop without a clean reference is noReference and not counted', () => {
    const unreferenced = stopWith(0, { lossMs: 30_000, refsValid: false });
    const clean = stopWith(1, { lossMs: 24_000 });
    const out = compute(viewOf([unreferenced, clean]));
    expect(out.stops.find((s) => s.carId === carId(0))).toEqual({
      carId: carId(0), lap: 10, condition: 'green', lossMs: unknown('insufficientData'), stationaryMs: 2_500, use: 'noReference',
    });
    expect(out.conditions.green.sessionStops).toBe(1);
    // with no prior the estimate rests on the one counted stop alone: the unreferenced stop's loss is not in its median
    expect(out.conditions.green.lossMs).toMatchObject({ known: true, value: 24_000 });
  });

  it('blend: n = 0 is the prior, n = 2 is the mean of prior and session; the source turns session past half', () => {
    const priors = known(snapshot(20_000), 0);
    const losses: Ms[] = [23_000, 25_000, 27_000];
    const green = (n: number) => compute(viewOf(losses.slice(0, n).map((lossMs, car) => stopWith(car, { lossMs })), { priors })).conditions.green;
    const calibration = (sessionShare: number, parts: unknown = expect.any(String)) => ({ kind: 'calibration', setName: 'Zandvoort dry', sources: 3, sessionShare, parts });

    // n = 0: the prior, k = 2 → share 0
    expect(green(0)).toMatchObject({ lossMs: { known: true, value: 20_000 }, sessionStops: 0, source: calibration(0) });
    // n = 1: (23 000 + 2 × 20 000) / 3, share 1/3
    expect(green(1)).toMatchObject({ lossMs: { known: true, value: 21_000 }, sessionStops: 1, source: calibration(1 / 3) });
    // n = 2: (2 × 24 000 + 2 × 20 000) / 4, the mean of session and prior; share 1/2 is not past half
    expect(green(2)).toMatchObject({ lossMs: { known: true, value: 22_000 }, sessionStops: 2, source: calibration(0.5, '2 stops + calibration') });
    // n = 3: (3 × 25 000 + 2 × 20 000) / 5, share 3/5: measured this session
    expect(green(3)).toMatchObject({
      lossMs: { known: true, value: 23_000 },
      sessionStops: 3,
      source: { kind: 'session', sessionShare: 0.6, parts: '3 stops + calibration' },
    });
  });

  it("condition from the record's flag", () => {
    const out = compute(viewOf([stopWith(0, { lossMs: 12_000, flag: 'vsc' })]));
    expect(out.stops.map((s) => s.condition)).toEqual(['vsc']);
    expect(out.conditions.vsc).toMatchObject({ sessionStops: 1, lossMs: { known: true, value: 12_000 } });
    expect(out.conditions.green.sessionStops).toBe(0);
    expect(out.conditions.sc.sessionStops).toBe(0);
  });

  it('prior from the track file when priors are notApplicable', () => {
    const track = zandvoortTrack();
    const fileDefault = track.defaults.pitLossMs.green;
    if (!fileDefault.known) throw new Error('the Zandvoort track file holds a green pit-loss default');
    const out = compute(viewOf([], { track: known(track, 0), priors: unknown('notApplicable') }));
    expect(out.conditions.green).toMatchObject({
      lossMs: { known: true, value: fileDefault.value.value },
      sessionStops: 0,
      source: { kind: 'default', note: fileDefault.value.source, sessionShare: 0, parts: expect.any(String) },
    });
  });

  it('no priors, no track file, no stop: insufficientData', () => {
    const out = compute(viewOf([], { track: unknown('notApplicable'), priors: unknown('notApplicable') }));
    expect(out.stops).toEqual([]);
    for (const condition of ['green', 'vsc', 'sc'] as const) {
      expect(out.conditions[condition].lossMs).toEqual(unknown('insufficientData'));
      expect(out.conditions[condition].sessionStops).toBe(0);
    }
  });

  it("every car's stops count", () => {
    const ours = stopWith(0, { lossMs: 24_000 });
    const rival = stopWith(5, { lap: 12, lossMs: 26_000 });
    const out = compute(viewOf([ours, rival]));
    expect(out.stops.map((s) => [s.carId, s.lap, s.use])).toEqual([
      [carId(0), 10, 'used'],
      [carId(5), 12, 'used'],
    ]);
    expect(out.conditions.green.sessionStops).toBe(2);
    expect(out.conditions.green.lossMs).toMatchObject({ known: true, value: 25_000 });
  });

  it("the aggregate counts each session's stops once", () => {
    const aggregate = PIT_LOSS_PRIORS.entries['pitLoss.ms.green']?.aggregate;
    if (aggregate === undefined) throw new Error('pitLoss.ms.green declares an aggregate');
    // session 1: one stop of 20 000; session 2: two stops of 24 000 and 26 000. Counted once each: median 24 000;
    // session 1 counted twice it would be median(20 000, 20 000, 24 000, 26 000) = 22 000.
    const s1 = [stopWith(0, { lossMs: 20_000 })];
    const s2 = [stopWith(0, { lossMs: 24_000 }), stopWith(1, { lossMs: 26_000 })];
    const once = aggregate([storedSource(1, s1, 0, 1), storedSource(2, s2, 0, 1)], ctx);
    const twice = aggregate([storedSource(1, s1, 0, 1), storedSource(1, s1, 1, 1), storedSource(2, s2, 0, 1)], ctx);
    expect(once).toMatchObject({ known: true, value: 24_000 });
    expect(twice).toEqual(once);
  });

  // R12: a stop that served a penalty (a drive-through or stop-go in the pit lane) is no pit-lane loss.
  it('a stop that served a penalty is not counted', () => {
    const priors = known(snapshot(20_000), 0);
    const penalty = stopWith(0, { lossMs: 40_000, penaltyServed: true });
    const normal = stopWith(1, { lap: 12, lossMs: 23_000 });
    const out = compute(viewOf([penalty, normal], { priors }));
    const alone = compute(viewOf([normal], { priors }));
    // its loss may stay known: it is kept for the record but counts for no estimate
    expect(out.stops.find((s) => s.carId === carId(0))).toMatchObject({ carId: carId(0), lap: 10, condition: 'green', use: 'penalty' });
    expect(out.stops.find((s) => s.carId === carId(1))).toMatchObject({ lossMs: { known: true, value: 23_000 }, use: 'used' });
    expect(out.conditions.green.sessionStops).toBe(1);
    // the one-stop blend: (23 000 + 2 × 20 000) / 3
    expect(out.conditions.green).toMatchObject({ lossMs: { known: true, value: 21_000 }, sessionStops: 1 });
    const { lossMs, sessionStops, source } = alone.conditions.green;
    expect(out.conditions.green).toMatchObject({ lossMs, sessionStops, source });
  });

  it('a penalty stop is left out of the median stationary time', () => {
    const quick = stopWith(1, { inMs: 92_000, outMs: 95_000, refs: [80_000, 80_400, 80_200], stationaryMs: 2_400 });
    const slow = stopWith(2, { inMs: 92_000, outMs: 95_000, refs: [80_000, 80_400, 80_200], stationaryMs: 5_400 });
    // a stop-go: 10 s stationary for the penalty and the service; counted, it would lift the median to 5 400
    const stopGo = stopWith(0, { lap: 14, lossMs: 38_000, stationaryMs: 12_400, penaltyServed: true });
    const without = compute(viewOf([quick, slow]));
    const withPenalty = compute(viewOf([quick, slow, stopGo]));
    const normalStops = (out: PitLossOutput) => out.stops.filter((s) => s.carId !== carId(0));
    // the normal stops' median is 3 900: the slow stop's 1 500 above it are removed (26 600 − 1 500)
    expect(normalStops(without)).toMatchObject([
      { carId: carId(1), lossMs: { known: true, value: 26_600 }, use: 'used' },
      { carId: carId(2), lossMs: { known: true, value: 25_100 }, use: 'used' },
    ]);
    expect(normalStops(withPenalty)).toEqual(normalStops(without));
    expect(withPenalty.conditions.green.stationaryMedianMs).toMatchObject({ known: true, value: 3_900 });
    expect(withPenalty.conditions.green.lossMs).toEqual(without.conditions.green.lossMs);
  });

  it('the aggregate leaves penalty stops out', () => {
    const aggregate = PIT_LOSS_PRIORS.entries['pitLoss.ms.green']?.aggregate;
    if (aggregate === undefined) throw new Error('pitLoss.ms.green declares an aggregate');
    const normal = [stopWith(1, { lossMs: 24_000, stationaryMs: 2_400 }), stopWith(2, { lossMs: 26_000, stationaryMs: 2_600 })];
    // a drive-through on lap 14 and a stop-go on lap 16: counted, their losses would lift the median
    const penalties = [
      stopWith(0, { lap: 14, lossMs: 38_000, stationaryMs: 0, penaltyServed: true }),
      stopWith(3, { lap: 16, lossMs: 40_000, stationaryMs: 12_500, penaltyServed: true }),
    ];
    const without = aggregate([storedSource(1, normal, 1, 1)], ctx);
    const withPenalties = aggregate([storedSource(1, [...normal, ...penalties], 1, 1)], ctx);
    // the normal stops' median stationary time is 2 500: 24 000 and 25 900, median 24 950
    expect(without).toMatchObject({ known: true, value: 24_950 });
    expect(withPenalties).toEqual(without);
  });

  // SP4.1a fx3b (ruling R37; C43, C62a): the calibration panel's STOPS column is the unit's count of the stops its
  // aggregate takes the median of per condition: `used` stops with a known loss, each session counted once.
  it('samples counts the sources (stops) the aggregate used', () => {
    const samplesOf = (condition: Condition) => {
      const samples = PIT_LOSS_PRIORS.entries[`pitLoss.ms.${condition}`]?.samples;
      if (samples === undefined) throw new Error(`pitLoss.ms.${condition} declares no samples`);
      return samples;
    };
    // session 1: two green stops used, a green stop that served a penalty and one without a clean reference (both left
    // out), one VSC stop; session 2: one green stop. Session 1 is named by two sources (two of its stints).
    const s1 = [
      stopWith(0, { lossMs: 24_000 }),
      stopWith(1, { lossMs: 26_000 }),
      stopWith(2, { lap: 14, lossMs: 40_000, penaltyServed: true }),
      stopWith(3, { lossMs: 30_000, refsValid: false }),
      stopWith(4, { lap: 16, lossMs: 12_000, flag: 'vsc' }),
    ];
    const s2 = [stopWith(0, { lossMs: 22_000 })];
    const sources = [storedSource(1, s1, 0, 1), storedSource(1, s1, 1, 1), storedSource(2, s2, 0, 1)];
    // the aggregate's median rests on three green stops: 22 000, 24 000, 26 000
    expect(PIT_LOSS_PRIORS.entries['pitLoss.ms.green']?.aggregate?.(sources, ctx)).toMatchObject({ known: true, value: 24_000 });
    expect(samplesOf('green')(sources, ctx)).toBe(3);
    expect(samplesOf('vsc')(sources, ctx)).toBe(1);
    expect(samplesOf('sc')(sources, ctx)).toBe(0);
    expect(samplesOf('green')([], ctx)).toBe(0);
  });
});

// SP4.3b Task 11c (spec F8, cause 3): the in-lap's share of a stop differs by track (Spa ≈ 0.28, Texas ≈ 0), so
// `pit-loss` measures it per condition from this session's stops: per stop (in-lap − the car's reference lap) / the
// stop's loss (in-lap + out-lap loss), the median over the condition's counted stops, blended with the prior as the
// loss is, `(n · sessionMedian + k · prior) / (n + k)` with `priorWeightStops` k = 2. The prior is the config's
// `inLapShare` 0.26 (5.5 / 21.5 s, research 12 §5) for a track file without its own share (Task 26: below), whatever
// the calibration.
describe('pit-loss: the in-lap share (SP4.3b Task 11c)', () => {
  const PRIOR = 0.26;
  /** A green stop of car `car` whose in-lap costs `share` of a 20 000 ms loss over its `REF_MS` reference laps. */
  const stopWithShare = (car: number, share: number, o: { lap?: number; flag?: Condition } = {}) => {
    const lossMs = 20_000;
    const inMs = REF_MS + Math.round(share * lossMs);
    return stopWith(car, { inMs, outMs: 2 * REF_MS + lossMs - inMs, ...o });
  };
  const shareOf = (out: PitLossOutput, condition: Condition = 'green') => out.conditions[condition].inLapShare;

  // row 1
  it('with no stop measured the in-lap share is the prior 0.26', () => {
    expect(PIT_LOSS_CONFIG.defaults).toHaveProperty('inLapShare', PRIOR);
    const out = compute(viewOf([], { track: known(zandvoortTrack(), 0), priors: known(snapshot(20_000), 0) }));
    for (const condition of ['green', 'vsc', 'sc'] as const) expect(shareOf(out, condition)).toMatchObject({ known: true, value: PRIOR });
    // the prior is known without a calibration or a track file, and an override of the config is followed (C47)
    const bare = compute(viewOf([], { track: unknown('notApplicable'), priors: unknown('notApplicable') }));
    expect(shareOf(bare)).toMatchObject({ known: true, value: PRIOR });
    const overridden = compute(engineView({ history: history(), config: { [PIT_LOSS_CONFIG.key]: { inLapShare: 0.4 } } }));
    expect(shareOf(overridden)).toMatchObject({ known: true, value: 0.4 });
    // a stop without a clean reference measures nothing
    expect(shareOf(compute(viewOf([stopWith(0, { lossMs: 20_000, refsValid: false })])))).toMatchObject({ known: true, value: PRIOR });
  });

  // row 2
  it('two stops with in-lap shares 0.05 and 0.07 give (2·0.06 + 2·0.26)/4', () => {
    // in-laps 1 000 and 1 400 ms over the reference, each stop's loss 20 000 ms
    const out = compute(viewOf([stopWithShare(0, 0.05), stopWithShare(1, 0.07, { lap: 12 })]));
    expect(out.conditions.green.sessionStops).toBe(2);
    const share = shareOf(out);
    expect(share.known).toBe(true);
    if (share.known) expect(share.value).toBeCloseTo((2 * 0.06 + 2 * PRIOR) / 4, 9);
    // per condition: green stops leave the VSC and SC shares at the prior
    expect(shareOf(out, 'vsc')).toMatchObject({ known: true, value: PRIOR });
    expect(shareOf(out, 'sc')).toMatchObject({ known: true, value: PRIOR });
    // and a VSC stop's share is the VSC condition's alone: (0.5 + 2 · 0.26) / 3
    const vsc = shareOf(compute(viewOf([stopWithShare(0, 0.05), stopWithShare(1, 0.5, { lap: 12, flag: 'vsc' })])), 'vsc');
    expect(vsc.known).toBe(true);
    if (vsc.known) expect(vsc.value).toBeCloseTo((0.5 + 2 * PRIOR) / 3, 9);
  });

  // row 4
  it('a session with an in-lap that costs nothing (share 0) moves the share towards 0 as stops accumulate', () => {
    const shares: number[] = [];
    for (let n = 1; n <= 4; n++) {
      const stops = Array.from({ length: n }, (_, car) => stopWithShare(car, 0, { lap: 10 + 2 * car }));
      const share = shareOf(compute(viewOf(stops)));
      expect(share.known, `${n} stops`).toBe(true);
      if (share.known) {
        // (n · 0 + 2 · 0.26) / (n + 2)
        expect(share.value, `${n} stops`).toBeCloseTo((2 * PRIOR) / (n + 2), 9);
        shares.push(share.value);
      }
    }
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeLessThan(shares[i - 1]!);
  });
});

// SP4.3b Task 26 (spec F2, Q5 A; C62b, C3): the in-lap share's prior is the track file's `defaults.pitLossInLapShare`
// where known (F1 25 charges ~0.28 of a green stop's loss on the in-lap at Spa, ~0.02 at Texas), else the config's
// `inLapShare`; the session's stops move the share from that prior with `priorWeightStops` as they do from the config's.
describe("pit-loss: the in-lap share's prior from the track file (SP4.3b Task 26)", () => {
  const CONFIG_PRIOR = 0.26;
  const TRACK_SHARE = 0.02;
  /** The Zandvoort track file with the in-lap share `share`. */
  const trackWith = (share: TrackData['defaults']['pitLossInLapShare']): EngineView['track'] => {
    const track = zandvoortTrack();
    return known({ ...track, defaults: { ...track.defaults, pitLossInLapShare: share } }, 0);
  };
  const TEXAS_LIKE = trackWith(known({ value: TRACK_SHARE, source: 'test: F1 25 Texas' }, 0));
  /** A green stop of car `car` whose in-lap costs `share` of a 20 000 ms loss over its `REF_MS` reference laps. */
  const stopWithShare = (car: number, share: number, o: { lap?: number; flag?: Condition } = {}) => {
    const lossMs = 20_000;
    const inMs = REF_MS + Math.round(share * lossMs);
    return stopWith(car, { inMs, outMs: 2 * REF_MS + lossMs - inMs, ...o });
  };
  const shareOf = (out: PitLossOutput, condition: Condition = 'green') => out.conditions[condition].inLapShare;
  const CONDITIONS = ['green', 'vsc', 'sc'] as const;

  // row 1
  it("pit-loss: with the track file's pitLossInLapShare known, the in-lap share's prior is it; with no session stop the share is exactly it", () => {
    const out = compute(viewOf([], { track: TEXAS_LIKE, priors: unknown('notApplicable') }));
    for (const condition of CONDITIONS) expect(shareOf(out, condition), condition).toMatchObject({ known: true, value: TRACK_SHARE });
    // a calibration holds no share: the track's stays the prior
    expect(shareOf(compute(viewOf([], { track: TEXAS_LIKE, priors: known(snapshot(20_000), 0) })))).toMatchObject({ known: true, value: TRACK_SHARE });
    // a share of 0 is a known share, not a missing one (C3)
    const zero = compute(viewOf([], { track: trackWith(known({ value: 0, source: 'test' }, 0)) }));
    expect(shareOf(zero)).toMatchObject({ known: true, value: 0 });
  });

  // row 2
  it("pit-loss: with it unknown (or the track unknown), the prior is the config's inLapShare, as today", () => {
    const cases: [string, EngineView['track']][] = [
      ['the track file without the share', trackWith(unknown('notReceived'))],
      ['no track file', unknown('notApplicable')],
    ];
    for (const [what, track] of cases) {
      const out = compute(viewOf([], { track }));
      for (const condition of CONDITIONS) expect(shareOf(out, condition), `${what}, ${condition}`).toMatchObject({ known: true, value: CONFIG_PRIOR });
      // an override of the config is followed (C47)
      const overridden = compute(engineView({ history: history(), track, config: { [PIT_LOSS_CONFIG.key]: { inLapShare: 0.4 } } }));
      expect(shareOf(overridden), what).toMatchObject({ known: true, value: 0.4 });
    }
  });

  // row 3
  it("pit-loss: session stops move the share from the track's prior with priorWeightStops, as they move it from the config's today", () => {
    const stops = [stopWithShare(0, 0.05), stopWithShare(1, 0.07, { lap: 12 })];
    // two green stops with shares 0.05 and 0.07, k = 2: (2 · 0.06 + 2 · 0.02) / 4
    const out = compute(viewOf(stops, { track: TEXAS_LIKE }));
    expect(out.conditions.green.sessionStops).toBe(2);
    const share = shareOf(out);
    expect(share.known).toBe(true);
    if (share.known) expect(share.value).toBeCloseTo((2 * 0.06 + 2 * TRACK_SHARE) / 4, 9);
    // the other conditions keep the track's prior
    expect(shareOf(out, 'vsc')).toMatchObject({ known: true, value: TRACK_SHARE });
    expect(shareOf(out, 'sc')).toMatchObject({ known: true, value: TRACK_SHARE });
    // k is the config's priorWeightStops: with k = 1, (2 · 0.06 + 0.02) / 3
    const history1 = history({ laps: stops.flatMap((s) => s.laps), pitStops: stops.map((s) => s.stop) });
    const k1 = shareOf(compute(engineView({ history: history1, track: TEXAS_LIKE, config: { [PIT_LOSS_CONFIG.key]: { priorWeightStops: 1 } } })));
    expect(k1.known).toBe(true);
    if (k1.known) expect(k1.value).toBeCloseTo((2 * 0.06 + TRACK_SHARE) / 3, 9);
  });
});
