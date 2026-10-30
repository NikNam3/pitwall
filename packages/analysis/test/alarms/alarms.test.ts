import { carId, known, unknown, type CarBands, type DamageState, type ErsState, type FuelState, type Insight, type TyreWear } from '@pitwall/domain';
import { InsightBook, type EngineView, type History } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { ALARMS } from '../../src/alarms/index.ts';
import { alarmsCalculator } from '../../src/alarms/calculator.ts';
import { CAR_BANDS, CAR_BANDS_CONFIG } from '../../src/car-bands/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import { damageCalculator } from '../../src/damage/calculator.ts';
import { ERS } from '../../src/ers/index.ts';
import { ersCalculator } from '../../src/ers/calculator.ts';
import { FUEL } from '../../src/fuel/index.ts';
import { fuelCalculator } from '../../src/fuel/calculator.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../../src/session-remaining/index.ts';
import { TYRE_WEAR } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { carState, engineView, event, lap, realismHidden, telemetryRestricted } from '../../../../test-support/builders/index.ts';

// Assumptions pinned here (see the test report): key = `${kind}:${carId}:${channel}`; channel names `tyre.<surfaceC|carcassC|pressurePsi>.<corner>`,
// `brakesC.<corner>`, `engineC`, `wear.<corner>`, `fuel`, `warnings`; `damageJump` and `penaltyNew` use the jump's / event's session time as channel;
// `compute` returns the active alarms and `insights` returns them unchanged; raisedAt = view.state.sessionTime.

const perCorner = <T>(make: () => T) => ({ fl: make(), fr: make(), rl: make(), rr: make() });
/**
 * The `car-bands` config of every `viewWith` view (the defaults before 2026-10-30), so the band cases below don't
 * depend on the defaults: dry surface 85-105, dry carcass 85-110, inter surface 60-90, inter carcass 55-75,
 * pressure 20-31, brakes 300-1000, engine 0-125.
 */
const TEST_BANDS = {
  surfaceDryLo: 85, surfaceDryHi: 105, surfaceInterLo: 60, surfaceInterHi: 90, surfaceWetLo: 50, surfaceWetHi: 80,
  carcassDryLo: 85, carcassDryHi: 110, carcassInterLo: 55, carcassInterHi: 75, carcassWetLo: 45, carcassWetHi: 65,
  pressureLo: 20, pressureHi: 31, brakeLo: 300, brakeHi: 1000, engineHi: 125,
};
const CORNER_IDS = ['fl', 'fr', 'rl', 'rr'] as const;
const NOW = 12_345;

const reading = (state: 'below' | 'in' | 'above', over: { outForFullLap?: boolean; value?: number } = {}) => ({
  value: known(over.value ?? 95, 0),
  state: known(state, 0),
  band: { lo: 85, hi: 105 },
  outForFullLap: over.outForFullLap ?? false,
});
const bandsOk = (): CarBands => ({
  tyres: perCorner(() => ({ surfaceC: reading('in'), carcassC: reading('in'), pressurePsi: reading('in') })),
  brakesC: perCorner(() => reading('in')),
  engineC: reading('in'),
});
const wearOk = (): TyreWear => ({
  corners: perCorner(() => ({ wearPct: known(20, 0), ratePctPerLap: known(2, 0), lapsToLimit: known(20, 0) })),
  limitPct: 80,
  warnLaps: 3,
  gameLifeSpanLaps: known(30, 0),
});
const fuelOk = (): FuelState => ({
  kg: known(50, 0),
  burnKgPerLap: known(2, 0),
  lapsOfFuel: known(25, 0),
  lapsLeft: known(20, 0),
  marginLaps: known(5, 0),
  saveTargetKgPerLap: { known: false, reason: 'notApplicable' },
  gameRemainingLaps: known(20, 0),
  mix: known('standard', 0),
});
const damageOk = (): DamageState => ({
  parts: known(
    { frontLeftWingPct: 0, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0 },
    0,
  ),
  corners: perCorner(() => ({ tyrePct: known(0, 0), brakePct: known(0, 0) })),
  drsFault: known(false, 0),
  ersFault: false,
  jumps: [],
});

type Parts = { bands?: CarBands; wear?: TyreWear; fuel?: FuelState; damage?: DamageState };
/** The five upstream outputs of one car (benign unless overridden). */
const outputsFor = (id: number, p: Parts = {}) => ({
  [id]: { bands: p.bands ?? bandsOk(), wear: p.wear ?? wearOk(), fuel: p.fuel ?? fuelOk(), damage: p.damage ?? damageOk() },
});
const outputsOf = (perCar: ReturnType<typeof outputsFor>[]): ReadonlyMap<string, unknown> => {
  const merged = Object.assign({}, ...perCar) as Record<number, ReturnType<typeof outputsFor>[number]>;
  const pick = (f: (v: ReturnType<typeof outputsFor>[number]) => unknown) =>
    Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, f(v)]));
  return new Map<string, unknown>([
    [TYRE_WEAR, pick((v) => v.wear)],
    [FUEL, pick((v) => v.fuel)],
    [ERS, {}],
    [CAR_BANDS, pick((v) => v.bands)],
    [DAMAGE, pick((v) => v.damage)],
  ]);
};

type ViewOpts = { warnings?: number; lap?: number; history?: Partial<History>; config?: EngineView['config']; playerCar?: number };
const viewWith = (parts: Parts, o: ViewOpts = {}): EngineView =>
  engineView({
    cars: [carState({ timing: { cornerCuttingWarnings: o.warnings ?? 0, lap: o.lap ?? 1 } })],
    outputs: outputsOf([outputsFor(0, parts)]),
    sessionTime: NOW,
    ...(o.history && { history: o.history }),
    config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS, ...o.config },
    ...(o.playerCar !== undefined && { playerCar: o.playerCar }),
  });

/** A completed lap of car 0 whose channel ranges are the builder's (all in band) except `over`, e.g. `{ 'brakesC.fl': [250, 290] }`. */
const lapWith = (over: Record<string, [number, number]>, rec: Parameters<typeof lap>[0] = {}) => {
  const l = lap(rec);
  for (const [channel, [min, max]] of Object.entries(over)) {
    const r = known({ min, max }, l.completedAt);
    const [head, second, third] = channel.split('.') as [string, string, string];
    if (head === 'tyre') l.channelRange.tyres[third as 'fl'][second as 'surfaceC'] = r;
    else if (head === 'brakesC') l.channelRange.brakesC[second as 'fl'] = r;
    else l.channelRange.engineC = r;
  }
  return l;
};
const lapsView = (laps: ReturnType<typeof lap>[], parts: Parts = {}, o: ViewOpts = {}) => viewWith(parts, { ...o, history: { ...o.history, laps } });

const run = (view: EngineView): Insight[] => alarmsCalculator.insights!(alarmsCalculator.compute(view), undefined, view);
const only = (view: EngineView, kind: string) => run(view).filter((i) => i.kind === kind);

describe('alarms calculator', () => {
  it('is the quick calculator `alarms` at 2 Hz reading the four analyses it raises on and the car state', () => {
    expect(alarmsCalculator.id).toBe(ALARMS);
    expect(alarmsCalculator.kind).toBe('quick');
    expect(alarmsCalculator.cadence).toEqual({ hz: 2 });
    expect(alarmsCalculator.reads).toEqual(
      expect.arrayContaining([TYRE_WEAR, FUEL, CAR_BANDS, DAMAGE].map((calculator) => ({ calculator }))),
    );
    // no ERS alarm exists, so ERS is no input: a new ERS output must not re-run the alarms
    expect(alarmsCalculator.reads).not.toContainEqual({ calculator: ERS });
    expect(alarmsCalculator.reads).toEqual(expect.arrayContaining(['timing', 'events', 'laps']));
  });

  it('raises nothing when everything is in order', () => {
    expect(run(viewWith({}))).toEqual([]);
  });

  describe('spec 5.6 rows', () => {
    it('a tyre channel out of band for a full lap: critical, tyres, bandOutLap', () => {
      const bands = bandsOk();
      bands.tyres.fl.surfaceC = reading('above', { outForFullLap: true, value: 120 });
      const [a, ...rest] = run(viewWith({ bands }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'bandOutLap',
        severity: 'critical',
        category: 'tyres',
        carId: carId(0),
        key: 'bandOutLap:0:tyre.surfaceC.fl',
        raisedAt: NOW,
        params: { channel: 'tyre.surfaceC.fl', lo: 85, hi: 105 },
      });
    });

    it('a brake or engine channel out of band for a full lap: critical, car', () => {
      const bands = bandsOk();
      bands.brakesC.rr = reading('below', { outForFullLap: true });
      bands.engineC = reading('above', { outForFullLap: true });
      const found = run(viewWith({ bands }));
      expect(found.map((i) => [i.key, i.kind, i.severity, i.category]).sort()).toEqual([
        ['bandOutLap:0:brakesC.rr', 'bandOutLap', 'critical', 'car'],
        ['bandOutLap:0:engineC', 'bandOutLap', 'critical', 'car'],
      ]);
    });

    it('a tyre channel out of band on the mid-range of the last lap: advisory, tyres, bandOut with state, value, band, lap and measure', () => {
      const [a, ...rest] = run(lapsView([lapWith({ 'tyre.pressurePsi.rr': [31, 33] }, { lapNumber: 4 })]));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'bandOut',
        severity: 'advisory',
        category: 'tyres',
        key: 'bandOut:0:tyre.pressurePsi.rr',
        params: { channel: 'tyre.pressurePsi.rr', state: 'above', value: 32, lo: 20, hi: 31, lap: 4, measure: 'midRange' },
      });
    });

    it('a brake or engine channel out of band on the peak of the last lap: advisory, car', () => {
      const found = run(lapsView([lapWith({ 'brakesC.fl': [180, 290], engineC: [120, 130] })]));
      expect(found.map((i) => [i.key, i.kind, i.severity, i.category, i.params['state'], i.params['value'], i.params['measure']]).sort()).toEqual([
        ['bandOut:0:brakesC.fl', 'bandOut', 'advisory', 'car', 'below', 290, 'peak'],
        ['bandOut:0:engineC', 'bandOut', 'advisory', 'car', 'above', 130, 'peak'],
      ]);
    });

    it('a channel out for a full lap raises bandOutLap only, not also bandOut', () => {
      const bands = bandsOk();
      bands.tyres.fr.carcassC = reading('above', { outForFullLap: true });
      expect(run(viewWith({ bands })).map((i) => i.kind)).toEqual(['bandOutLap']);
    });

    it('laps to the wear limit below the threshold (default 3): critical, tyres, wearLimitNear; 3 is not below', () => {
      const wear = wearOk();
      wear.corners.rl.lapsToLimit = known(2.5, 0);
      wear.corners.rr.lapsToLimit = known(3, 0);
      const [a, ...rest] = only(viewWith({ wear }), 'wearLimitNear');
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        severity: 'critical',
        category: 'tyres',
        carId: carId(0),
        key: 'wearLimitNear:0:wear.rl',
        params: { corner: 'rl', lapsToLimit: 2.5, wearPct: 20, limitPct: 80 },
      });
      expect(run(viewWith({ wear }))).toHaveLength(1);
    });

    it('a tyre past the wear limit keeps wearLimitNear raised: tyre-wear gives 0 laps to the limit there', () => {
      const corners = perCorner(() => ({ wearPct: known(76, 0) }));
      const wearView = engineView({ cars: [carState({ tyres: { corners } })], history: { laps: [64, 68, 72].map((w, i) => lap({ lapNumber: i + 1, wearAtEndPct: perCorner(() => known(w, 0)) })) } });
      const wear = tyreWearCalculator.compute(wearView)[carId(0)]!;
      expect(wear.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 0 });
      expect(only(viewWith({ wear }), 'wearLimitNear').map((i) => i.key)).toEqual(['wearLimitNear:0:wear.fl', 'wearLimitNear:0:wear.fr', 'wearLimitNear:0:wear.rl', 'wearLimitNear:0:wear.rr']);
    });

    it('the wear threshold is read from config', () => {
      const wear = wearOk();
      wear.corners.fl.lapsToLimit = known(4, 0);
      expect(run(viewWith({ wear }))).toEqual([]);
      expect(run(viewWith({ wear }, { config: { alarms: { wearLapsWarning: 5 } } })).map((i) => i.key)).toEqual(['wearLimitNear:0:wear.fl']);
    });

    it('fuel margin below zero: critical, energy, fuelShort with the margin; zero is not short', () => {
      const f = { ...fuelOk(), marginLaps: known(-1.5, 0) };
      const [a, ...rest] = run(viewWith({ fuel: f }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({ kind: 'fuelShort', severity: 'critical', category: 'energy', key: 'fuelShort:0:fuel', params: { marginLaps: -1.5 } });
      expect(run(viewWith({ fuel: { ...fuelOk(), marginLaps: known(0, 0) } }))).toEqual([]);
    });

    it('a damage jump on the current lap: critical, damage, damageJump with lap, parts and delta', () => {
      const damage = {
        ...damageOk(),
        jumps: [{ at: 5_000, lap: 3, parts: ['rearWingPct' as const, 'floorPct' as const], deltaPct: 12, lossMsPerLap: unknown('insufficientData') }],
      };
      const [a, ...rest] = run(viewWith({ damage }, { lap: 3 }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'damageJump',
        severity: 'critical',
        category: 'damage',
        carId: carId(0),
        key: 'damageJump:0:5000',
        params: { lap: 3, parts: 'rearWingPct,floorPct', deltaPct: 12 },
      });
    });

    it('one corner-cutting warning left before a penalty: advisory, race, warningLast', () => {
      const [a, ...rest] = run(viewWith({}, { warnings: 2 }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'warningLast',
        severity: 'advisory',
        category: 'race',
        carId: carId(0),
        key: 'warningLast:0:warnings',
        params: { warnings: 2, before: 3 },
      });
    });

    it('a new penalty for our car: critical, race, penaltyNew with the event params', () => {
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType: 4, infringementType: 7, timeMs: 5000, lap: 2 } });
      const [a, ...rest] = run(viewWith({}, { history: { laps: [lap({ lapNumber: 1 })], events: [penalty] } }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'penaltyNew',
        severity: 'critical',
        category: 'race',
        carId: carId(0),
        key: 'penaltyNew:0:100000',
        params: { penaltyType: 4, infringementType: 7, timeMs: 5000, lap: 2 },
      });
    });
  });

  describe('band advisories judge the last completed lap, not the live value', () => {
    it('a brake below its band now but whose last lap peaked in band raises nothing (the B3 flicker: FL 297 °C on a straight)', () => {
      const bands = bandsOk();
      bands.brakesC.fl = reading('below', { value: 297 });
      expect(run(lapsView([lapWith({ 'brakesC.fl': [235, 865] })], { bands }))).toEqual([]);
    });

    it('a live value out of band raises no advisory before the car has completed a lap', () => {
      const bands = bandsOk();
      bands.brakesC.fl = reading('below', { value: 25 });
      bands.tyres.fr.surfaceC = reading('below', { value: 45 });
      bands.engineC = reading('above', { value: 140 });
      expect(run(viewWith({ bands }))).toEqual([]);
    });

    it('within a lap the advisory does not change while the live values swing across the band', () => {
      const laps = [lapWith({ 'brakesC.fl': [180, 290] })];
      const outs = [25, 297, 865, 1100].map((value) => {
        const bands = bandsOk();
        bands.brakesC.fl = reading(value < 300 ? 'below' : value > 1000 ? 'above' : 'in', { value });
        return run(lapsView(laps, { bands })).map((i) => [i.key, i.params['state'], i.params['value']]);
      });
      for (const out of outs) expect(out).toEqual([['bandOut:0:brakesC.fl', 'below', 290]]);
    });

    it('brakes judge the peak: a lap that dips below the band but peaks in it is in; a peak above the band is above', () => {
      expect(run(lapsView([lapWith({ 'brakesC.rr': [120, 750] })]))).toEqual([]);
      expect(run(lapsView([lapWith({ 'brakesC.rr': [400, 1050] })])).map((i) => [i.key, i.params['state'], i.params['value']])).toEqual([
        ['bandOut:0:brakesC.rr', 'above', 1050],
      ]);
    });

    it('tyre channels judge the mid-range of the lap: surface 70-98 °C (84) is below the dry band, 80-100 °C (90) is in', () => {
      expect(run(lapsView([lapWith({ 'tyre.surfaceC.fl': [70, 98] })])).map((i) => [i.key, i.params['state'], i.params['value']])).toEqual([
        ['bandOut:0:tyre.surfaceC.fl', 'below', 84],
      ]);
      expect(run(lapsView([lapWith({ 'tyre.surfaceC.fl': [80, 100] })]))).toEqual([]);
      expect(run(lapsView([lapWith({ 'tyre.carcassC.rl': [110, 114] })])).map((i) => [i.key, i.params['state']])).toEqual([
        ['bandOut:0:tyre.carcassC.rl', 'above'],
      ]);
    });

    it('the band is the one of the lap compound: an inter lap at 65-75 °C surface is in, though below the dry band', () => {
      const inter = { visualCompound: 'inter' as const, actualCompound: 'inter' as const };
      const all = Object.fromEntries((['fl', 'fr', 'rl', 'rr'] as const).flatMap((c) => [[`tyre.surfaceC.${c}`, [65, 75]], [`tyre.carcassC.${c}`, [60, 70]]])) as Record<string, [number, number]>;
      expect(run(lapsView([lapWith(all, inter)]))).toEqual([]);
      expect(run(lapsView([lapWith(all)])).map((i) => i.key)).toContain('bandOut:0:tyre.surfaceC.fl');
    });

    it('the bands come from the car-bands config', () => {
      const laps = [lapWith({ 'brakesC.fl': [200, 340] })];
      expect(run(lapsView(laps))).toEqual([]);
      expect(run(lapsView(laps, {}, { config: { 'car-bands': { ...TEST_BANDS, brakeLo: 350 } } })).map((i) => [i.key, i.params['lo']])).toEqual([['bandOut:0:brakesC.fl', 350]]);
    });

    it('judges the highest-numbered lap of the car; laps of another car do not count', () => {
      const hot = lapWith({ engineC: [126, 128] }, { lapNumber: 2 });
      const cool = lapWith({}, { lapNumber: 3 });
      expect(run(lapsView([hot, cool]))).toEqual([]);
      expect(run(lapsView([cool, hot].map((l, i) => ({ ...l, lapNumber: 3 + i })))).map((i) => [i.key, i.params['lap']])).toEqual([['bandOut:0:engineC', 4]]);
      expect(run(lapsView([cool, { ...hot, carId: carId(5), lapNumber: 9 }]))).toEqual([]);
    });

    it('an unknown range of the last lap raises nothing, never a zero reading', () => {
      const l = lap();
      l.channelRange.brakesC.fl = unknown('notReceived');
      l.channelRange.engineC = unknown('notReceived');
      expect(run(lapsView([l]))).toEqual([]);
    });

    it('the advisory changes at the end of a lap: raised when a lap ends out of band, resolved when the next ends in band', () => {
      const out = lapWith({ 'brakesC.fl': [180, 290] }, { lapNumber: 1 });
      const back = lapWith({}, { lapNumber: 2 });
      const book = new InsightBook();
      expect(book.apply(ALARMS, run(lapsView([])), 1_000)).toEqual([]);
      expect(book.apply(ALARMS, run(lapsView([out])), 90_000)).toEqual([{ type: 'raised', insight: expect.objectContaining({ key: 'bandOut:0:brakesC.fl' }) }]);
      expect(book.apply(ALARMS, run(lapsView([out])), 120_000)).toEqual([]);
      expect(book.apply(ALARMS, run(lapsView([out, back])), 180_000)).toEqual([{ type: 'resolved', key: 'bandOut:0:brakesC.fl', at: 180_000 }]);
    });
  });

  describe('warningsBeforePenalty', () => {
    it('two cornerCuttingWarnings with warningsBeforePenalty 3 raises warningLast; one does not', () => {
      const config = { alarms: { warningsBeforePenalty: 3 } };
      expect(only(viewWith({}, { warnings: 2, config }), 'warningLast')).toHaveLength(1);
      expect(only(viewWith({}, { warnings: 1, config }), 'warningLast')).toEqual([]);
    });

    it('is not raised at none, at the penalty count, or beyond it', () => {
      const config = { alarms: { warningsBeforePenalty: 3 } };
      for (const warnings of [0, 3, 4]) expect(only(viewWith({}, { warnings, config }), 'warningLast')).toEqual([]);
    });

    it('after a penalty the count runs on: one warning before the next penalty raises it again (5 and 8 with 3)', () => {
      const config = { alarms: { warningsBeforePenalty: 3 } };
      for (const warnings of [5, 8]) expect(only(viewWith({}, { warnings, config }), 'warningLast')).toHaveLength(1);
      for (const warnings of [6, 7]) expect(only(viewWith({}, { warnings, config }), 'warningLast')).toEqual([]);
    });

    it('with a penalty on every warning (1) there is never one warning left', () => {
      const config = { alarms: { warningsBeforePenalty: 1 } };
      for (const warnings of [0, 1, 2]) expect(only(viewWith({}, { warnings, config }), 'warningLast')).toEqual([]);
    });

    it('follows the config: with 4, three warnings raise it and two do not', () => {
      const config = { alarms: { warningsBeforePenalty: 4 } };
      expect(only(viewWith({}, { warnings: 3, config }), 'warningLast')).toHaveLength(1);
      expect(only(viewWith({}, { warnings: 2, config }), 'warningLast')).toEqual([]);
    });
  });

  describe('resolution', () => {
    it('an alarm resolves when its condition ends', () => {
      const bad = bandsOk();
      bad.engineC = reading('above', { outForFullLap: true });
      const book = new InsightBook();
      const first = book.apply(ALARMS, run(viewWith({ bands: bad })), 1_000);
      expect(first).toEqual([{ type: 'raised', insight: expect.objectContaining({ key: 'bandOutLap:0:engineC', raisedAt: 1_000 }) }]);
      expect(book.apply(ALARMS, run(viewWith({ bands: bad })), 2_000)).toEqual([]);
      expect(book.apply(ALARMS, run(viewWith({ bands: bandsOk() })), 3_000)).toEqual([{ type: 'resolved', key: 'bandOutLap:0:engineC', at: 3_000 }]);
    });

    it('a channel that gets worse resolves bandOut and raises bandOutLap under a different key', () => {
      const laps = [lapWith({ engineC: [126, 130] })];
      const late = bandsOk();
      late.engineC = reading('above', { outForFullLap: true });
      const book = new InsightBook();
      book.apply(ALARMS, run(lapsView(laps)), 1);
      const changes = book.apply(ALARMS, run(lapsView(laps, { bands: late })), 2);
      expect(changes.map((c) => (c.type === 'raised' ? c.insight.key : c.key))).toEqual(['bandOut:0:engineC', 'bandOutLap:0:engineC']);
    });

    it('a damage jump lasts for its lap and resolves on the next', () => {
      const damage = { ...damageOk(), jumps: [{ at: 5_000, lap: 3, parts: ['floorPct' as const], deltaPct: 9, lossMsPerLap: unknown('insufficientData') }] };
      expect(only(viewWith({ damage }, { lap: 3 }), 'damageJump')).toHaveLength(1);
      expect(only(viewWith({ damage }, { lap: 4 }), 'damageJump')).toEqual([]);
    });

    it('a penalty lasts until our car completes its next lap, then resolves; another car\'s lap does not end it', () => {
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType: 4, lap: 2 } });
      const hist = (laps: ReturnType<typeof lap>[]) => ({ laps, events: [penalty] });
      const before = [lap({ lapNumber: 1 })];
      expect(only(viewWith({}, { history: hist(before) }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { history: hist([...before, lap({ carId: carId(5), lapNumber: 2, completedAt: 180_000 })]) }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { history: hist([...before, lap({ lapNumber: 2 })]) }), 'penaltyNew')).toEqual([]);
    });

    it('a penalty before our first completed lap counts as new', () => {
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 1_000, params: { penaltyType: 0, lap: 1 } });
      expect(only(viewWith({}, { history: { events: [penalty] } }), 'penaltyNew')).toHaveLength(1);
    });

    it('a warning, a reminder, a lap invalidation or the black-flag timer is no penaltyNew; a real penalty is', () => {
      // F1 25 penalty types: 5 warning, 3 reminder, 10-15 lap invalidated, 17 black-flag timer; 4 time penalty, 6 disqualified
      for (const penaltyType of [3, 5, 10, 11, 12, 13, 14, 15, 17]) {
        const e = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType, infringementType: 7, lap: 2 } });
        expect(only(viewWith({}, { history: { laps: [lap()], events: [e] } }), 'penaltyNew')).toEqual([]);
      }
      for (const penaltyType of [0, 1, 2, 4, 6, 9]) {
        const e = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType, infringementType: 7, lap: 2 } });
        expect(only(viewWith({}, { history: { laps: [lap()], events: [e] } }), 'penaltyNew')).toHaveLength(1);
      }
    });

    it('two penalties in one lap are two alarms with different keys', () => {
      const events = [
        event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType: 4, lap: 2 } }),
        event({ kind: 'penalty', carId: carId(0), at: 120_000, params: { penaltyType: 1, lap: 2 } }),
      ];
      expect(only(viewWith({}, { history: { laps: [lap()], events } }), 'penaltyNew').map((i) => i.key)).toEqual(['penaltyNew:0:100000', 'penaltyNew:0:120000']);
    });
  });

  describe('our cars only', () => {
    const badEverything = (): Parts => {
      const bands = bandsOk();
      bands.engineC = reading('above', { outForFullLap: true });
      const wear = wearOk();
      wear.corners.fl.lapsToLimit = known(1, 0);
      return { bands, wear, fuel: { ...fuelOk(), marginLaps: known(-2, 0) } };
    };
    const rivalView = (parts: Parts, rivalCar = carState({ id: carId(5), timing: { cornerCuttingWarnings: 2 } })): EngineView =>
      engineView({
        cars: [carState(), rivalCar],
        outputs: outputsOf([outputsFor(0), outputsFor(5, parts)]),
        history: { events: [event({ kind: 'penalty', carId: carId(5), at: 1_000, params: { penaltyType: 4, lap: 1 } })] },
        sessionTime: NOW,
      });

    it('no alarm for a rival, even with known bad values and warnings and penalties', () => {
      expect(run(rivalView(badEverything()))).toEqual([]);
    });

    it('no alarm on unknown(realism) data of a rival', () => {
      const hiddenBands: CarBands = {
        tyres: perCorner(() => ({
          surfaceC: { ...reading('in'), value: unknown('realism'), state: unknown('realism') },
          carcassC: { ...reading('in'), value: unknown('realism'), state: unknown('realism') },
          pressurePsi: { ...reading('in'), value: unknown('realism'), state: unknown('realism') },
        })),
        brakesC: perCorner(() => ({ ...reading('in'), value: unknown('realism'), state: unknown('realism') })),
        engineC: { ...reading('in'), value: unknown('realism'), state: unknown('realism') },
      };
      const hiddenWear: TyreWear = {
        ...wearOk(),
        corners: perCorner(() => ({ wearPct: unknown('realism'), ratePctPerLap: unknown('realism'), lapsToLimit: unknown('realism') })),
      };
      const hiddenFuel: FuelState = { ...fuelOk(), kg: unknown('realism'), marginLaps: unknown('realism'), lapsOfFuel: unknown('realism') };
      const hiddenDamage: DamageState = { ...damageOk(), parts: unknown('realism'), drsFault: unknown('realism') };
      const rival = realismHidden(carState({ id: carId(5) }));
      expect(run(rivalView({ bands: hiddenBands, wear: hiddenWear, fuel: hiddenFuel, damage: hiddenDamage }, rival))).toEqual([]);
    });

    it('unknown data of our own car raises nothing, never a zero reading', () => {
      const wear: TyreWear = { ...wearOk(), corners: perCorner(() => ({ wearPct: unknown('notReceived'), ratePctPerLap: unknown('notReceived'), lapsToLimit: unknown('notReceived') })) };
      const fuel: FuelState = { ...fuelOk(), marginLaps: unknown('notReceived') };
      const bands = bandsOk();
      bands.engineC = { ...reading('in'), value: unknown('notReceived'), state: unknown('notReceived') };
      expect(run(viewWith({ wear, fuel, bands }))).toEqual([]);
    });

    it('the teammate car is one of ours', () => {
      const view = rivalView(badEverything());
      const withTeammate: EngineView = { ...view, state: { ...view.state, teammateCar: carId(5) } };
      expect(run(withTeammate).every((i) => i.carId === carId(5))).toBe(true);
      expect(run(withTeammate).map((i) => i.kind).sort()).toEqual(['bandOutLap', 'fuelShort', 'penaltyNew', 'warningLast', 'wearLimitNear']);
    });

    it('after a playerCar change the old car\'s alarms are resolved', () => {
      const parts = badEverything();
      const cars = [carState({ timing: { cornerCuttingWarnings: 2 } }), carState({ id: carId(1) })];
      const outputs = outputsOf([outputsFor(0, parts), outputsFor(1)]);
      const make = (playerCar: number) => engineView({ cars, outputs, playerCar, sessionTime: NOW });
      const book = new InsightBook();
      const raised = book.apply(ALARMS, run(make(0)), 1_000);
      expect(raised.length).toBeGreaterThan(0);
      expect(raised.every((c) => c.type === 'raised' && c.insight.carId === carId(0))).toBe(true);
      expect(run(make(1))).toEqual([]);
      const changes = book.apply(ALARMS, run(make(1)), 2_000);
      expect(changes).toHaveLength(raised.length);
      expect(changes.every((c) => c.type === 'resolved' && c.at === 2_000)).toBe(true);
    });
  });
});

describe('hidden data of one of our cars (Review Focus 5)', () => {
  const TEAMMATE = carId(4);
  const restricted = unknown('restricted');
  /** Laps 1-5 of the teammate: wear 52 % rising 3 %/lap, fuel 10.5 kg falling 1.5 kg/lap. */
  const teammateLaps = () =>
    [1, 2, 3, 4, 5].map((n) =>
      lap({
        carId: TEAMMATE,
        lapNumber: n,
        wearAtEndPct: perCorner(() => known(49 + 3 * n, n * 90_000)),
        fuelAtEndKg: known(12 - 1.5 * n, n * 90_000),
      }),
    );
  /** As the engine records the same laps of a car whose driver withholds the telemetry: the lap-end samples are restricted too. */
  const hiddenLaps = () =>
    teammateLaps().map((l) => ({ ...l, wearAtEndPct: perCorner(() => restricted), fuelAtEndKg: restricted, fuelAtStartKg: restricted, ersStoreAtEndJ: restricted }));
  /** The teammate with 65 % wear and 3 kg of fuel: 2 laps to the 70 % limit, 2 laps of fuel for 10 laps left. */
  const teammate = () =>
    carState({
      id: TEAMMATE,
      tyres: { corners: perCorner(() => ({ wearPct: known(65, 0) })) },
      energy: { fuel: known({ kg: 3, capacityKg: 110, remainingLaps: 2, mix: 'standard' as const }, 0) },
    });

  /** The real upstream calculators over the view, then `alarms` over their outputs. */
  const chain = (car: ReturnType<typeof carState>, laps: ReturnType<typeof lap>[]) => {
    const remaining: SessionRemaining = { basis: 'laps', lapsLeft: known(10, 0), timeLeftMs: unknown('notApplicable') };
    const base = engineView({ cars: [carState(), car], history: { laps }, sessionTime: NOW, outputs: new Map([[SESSION_REMAINING, remaining]]) });
    const view: EngineView = { ...base, state: { ...base.state, teammateCar: TEAMMATE } };
    const outputs = new Map<string, unknown>([
      [SESSION_REMAINING, remaining],
      [TYRE_WEAR, tyreWearCalculator.compute(view)],
      [FUEL, fuelCalculator.compute(view)],
      [ERS, ersCalculator.compute(view)],
      [CAR_BANDS, carBandsCalculator.compute(view)],
      [DAMAGE, damageCalculator.output(damageCalculator.init(view))],
    ]);
    const withOutputs: EngineView = { ...view, outputs };
    return { outputs, alarms: run(withOutputs).filter((a) => a.carId === TEAMMATE) };
  };

  it('the teammate with its telemetry public raises the wear and fuel alarms (the case the next test hides)', () => {
    expect(chain(teammate(), teammateLaps()).alarms.map((a) => a.kind).sort()).toEqual(['fuelShort', ...CORNER_IDS.map(() => 'wearLimitNear')].sort());
  });

  it("a teammate whose driver withholds the telemetry: wear, fuel and ERS stay unknown('restricted') and raise no alarm", () => {
    const { outputs, alarms } = chain(telemetryRestricted(teammate()), hiddenLaps());
    const wear = (outputs.get(TYRE_WEAR) as Record<number, TyreWear>)[TEAMMATE]!;
    for (const corner of CORNER_IDS) expect(wear.corners[corner]).toEqual({ wearPct: restricted, ratePctPerLap: restricted, lapsToLimit: restricted });
    const fuel = (outputs.get(FUEL) as Record<number, FuelState>)[TEAMMATE]!;
    expect([fuel.kg, fuel.burnKgPerLap, fuel.lapsOfFuel, fuel.marginLaps, fuel.saveTargetKgPerLap]).toEqual([restricted, restricted, restricted, restricted, restricted]);
    const ers = (outputs.get(ERS) as Record<number, ErsState>)[TEAMMATE]!;
    expect([ers.storeJ, ers.storeTrendJPerLap, ers.attack]).toEqual([restricted, restricted, restricted]);
    expect(alarms).toEqual([]);
  });
});
