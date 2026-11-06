import { carId, known, unknown, type CarBands, type CarId, type DamageState, type ErsState, type FuelState, type Insight, type NeutralisedStage, type OpenSpan, type TyreWear, type WarnedDetail, type WeekendPhase } from '@pitwall/domain';
import { InsightBook, type EngineView, type Projection } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { ALARMS, ALARMS_BEHAVIOUR, type AlarmsEffect } from '../../src/alarms/index.ts';
import type { BehaviourTable } from '../../src/shared/behaviour.ts';
import { alarmsCalculator } from '../../src/alarms/calculator.ts';
import { CAR_BANDS, CAR_BANDS_BEHAVIOUR, CAR_BANDS_CONFIG } from '../../src/car-bands/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import { damageCalculator } from '../../src/damage/calculator.ts';
import { ERS } from '../../src/ers/index.ts';
import { ersCalculator } from '../../src/ers/calculator.ts';
import { FUEL } from '../../src/fuel/index.ts';
import { fuelCalculator } from '../../src/fuel/calculator.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../../src/session-remaining/index.ts';
import { TYRE_LIFE } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { TYRE_WEAR } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { NONE, openSpan, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';
import { withSetup } from '../own-car.ts';
import { scheduled } from '../scheduled.ts';

/** `damage` stepped: its output reads the view its accumulator was folded on (C31.2). */
const damage = scheduled(damageCalculator);
import { carState, engineView, event, lap, RACING, realismHidden, telemetryRestricted } from '../../../../test-support/builders/index.ts';

// Assumptions pinned here (see the test report): key = `${kind}:${carId}:${channel}`; channel names `tyre.<surfaceC|carcassC|pressurePsi>.<corner>`,
// `brakesC.<corner>`, `engineC`, `wear.<corner>`, `fuel`, `warnings`; `damageJump` uses the jump's session time as channel and `penaltyNew` the id of the `penalties` span;
// `compute` returns the active alarms and `insights` returns them unchanged; raisedAt = view.state.sessionTime.

const perCorner = <T>(make: () => T) => ({ fl: make(), fr: make(), rl: make(), rr: make() });
/**
 * The `car-bands` config of every `viewWith` view (the defaults before 2026-10-30), so the band cases below don't
 * depend on the defaults: dry surface 85-105, dry carcass 85-110, inter surface 60-90, inter carcass 55-75,
 * pressure setup - 1.5 to setup + 1.0 psi (car 0's setup is 25 psi on every corner: 23.5-26), brakes 300-1000, engine 0-125.
 */
const TEST_BANDS = {
  surfaceDryLo: 85, surfaceDryHi: 105, surfaceInterLo: 60, surfaceInterHi: 90, surfaceWetLo: 50, surfaceWetHi: 80,
  carcassDryLo: 85, carcassDryHi: 110, carcassInterLo: 55, carcassInterHi: 75, carcassWetLo: 45, carcassWetHi: 65,
  pressureBelowSetupPsi: 1.5, pressureAboveSetupPsi: 1.0, brakeLo: 300, brakeHi: 1000, engineHi: 125,
};
const CORNER_IDS = ['fl', 'fr', 'rl', 'rr'] as const;
const NOW = 12_345;

const reading = (state: 'below' | 'in' | 'above', over: { outForFullLap?: boolean; value?: number; band?: { lo: number; hi: number } } = {}) => ({
  value: known(over.value ?? 95, 0),
  state: known(state, 0),
  band: known(over.band ?? { lo: 85, hi: 105 }, 0),
  outForFullLap: over.outForFullLap ?? false,
});
/** Car 0's pressure band on its 25 psi setup. */
const PRESSURE_BAND = { lo: 23.5, hi: 26 };
const bandsOk = (): CarBands => ({
  tyres: perCorner(() => ({ surfaceC: reading('in'), carcassC: reading('in'), pressurePsi: reading('in', { value: 25, band: PRESSURE_BAND }) })),
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

/** An open span of `machine` of `kind` for car `car` (C20): what `view.situation` holds, the only source of warnings and penalties here. */
const open = (machine: string, kind: string, car: number, over: Partial<OpenSpan> = {}): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start: 1_000,
  confirmed: true,
  detail: undefined,
  startFrame: 1,
  carId: carId(car),
  ...over,
});
/**
 * The car's `warnings` span: `warned` with the count held, of which `cornerCutting` are corner-cutting warnings (by
 * default all of them), or `noWarning` at 0.
 */
const warned = (count: number, car = 0, cornerCutting = count): OpenSpan =>
  count === 0
    ? open('warnings', 'noWarning', car)
    : open('warnings', 'warned', car, { detail: { count, cornerCutting, infringement: unknown('notReceived') } satisfies WarnedDetail });
type Owes = { kind: 'clear' | 'timePenalty' | 'driveThroughPending' | 'stopGoPending'; id?: number; startFrame?: number; infringement?: number };
/** The car's `penalties` span: what it owes race control now, with the details the machine records. */
const owes = ({ kind, id = 0, startFrame = 50, infringement }: Owes, car = 0): OpenSpan =>
  open('penalties', kind, car, {
    id,
    startFrame,
    detail:
      kind === 'clear'
        ? undefined
        : kind === 'timePenalty'
          ? { totalMs: 5000 }
          : {
              driveThroughs: kind === 'driveThroughPending' ? 1 : 0,
              stopGos: kind === 'stopGoPending' ? 1 : 0,
              infringement: infringement === undefined ? unknown('notReceived') : known(infringement, 0),
              totalMs: 0,
            },
  });
/** The situation of `spans` in `phase` (default a race): the weekend-phase span that stands for the phase (C14, C20) and `spans`. */
const situationOf = (spans: readonly OpenSpan[], phase: WeekendPhase = RACE): EngineView['situation'] => {
  const byMachine: Record<string, OpenSpan[]> = {};
  if (phase.kind !== 'pending') {
    const { kind, ...detail } = phase;
    byMachine['weekend-phase'] = [openSpan('weekend-phase', kind, { detail })];
  }
  for (const span of spans) (byMachine[span.machine] ??= []).push(span);
  return { ...RACING, weekendPhase: phase, byMachine };
};

type ViewOpts = {
  warnings?: number;
  /** Of `warnings`, the corner-cutting ones (default: all of them). */
  cornerCutting?: number;
  owes?: Owes;
  spans?: OpenSpan[];
  lap?: number;
  history?: Partial<Projection>;
  config?: EngineView['config'];
  playerCar?: number;
  /** Car 0 without its setup (not yet received): its pressure band is unknown. By default its setup is 25 psi on every corner. */
  noSetup?: true;
  /** The weekend phase (default a race). */
  phase?: WeekendPhase;
};
const viewWith = (parts: Parts, o: ViewOpts = {}): EngineView =>
  engineView({
    cars: [o.noSetup ? carState({ timing: { lap: o.lap ?? 1 } }) : withSetup(carState({ timing: { lap: o.lap ?? 1 } }), 25)],
    outputs: outputsOf([outputsFor(0, parts)]),
    sessionTime: NOW,
    situation: situationOf([...(o.warnings === undefined ? [] : [warned(o.warnings, 0, o.cornerCutting)]), ...(o.owes === undefined ? [] : [owes(o.owes)]), ...(o.spans ?? [])], o.phase),
    ...(o.history && { history: o.history }),
    config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS, ...o.config },
    ...(o.playerCar !== undefined && { playerCar: o.playerCar }),
  });

/**
 * A completed lap of car 0 (lap 2 unless `rec` says otherwise: lap 1 of a race is not judged) whose channel ranges are the
 * builder's (all in band) except `over`, e.g. `{ 'brakesC.fl': [250, 290] }`.
 */
const lapWith = (over: Record<string, [number, number]>, rec: Parameters<typeof lap>[0] = {}) => {
  const l = lap({ lapNumber: 2, ...rec });
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
    expect(alarmsCalculator.reads).toEqual(expect.arrayContaining(['timing', 'laps', 'identity', 'spans:warnings', 'spans:penalties', 'spans:session-phase-race', 'spans:weekend-phase']));
    // warnings and penalties come from the machine's spans, not from the events list (C20)
    expect(alarmsCalculator.reads).not.toContain('events');
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
      // the pressure band is car 0's setup band (25 psi: 23.5-26)
      const [a, ...rest] = run(lapsView([lapWith({ 'tyre.pressurePsi.rr': [26, 28] }, { lapNumber: 4 })]));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'bandOut',
        severity: 'advisory',
        category: 'tyres',
        key: 'bandOut:0:tyre.pressurePsi.rr',
        params: { channel: 'tyre.pressurePsi.rr', state: 'above', value: 27, lo: 23.5, hi: 26, lap: 4, measure: 'midRange' },
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
      const wearParts = { cars: [carState({ tyres: { corners } })], history: { laps: [64, 68, 72].map((w, i) => lap({ lapNumber: i + 1, wearAtEndPct: perCorner(() => known(w, 0)) })) } };
      // tyre-wear publishes from tyre-life's output (spec 4.2): tyre-life computes on the view first
      const tyreLife = tyreLifeCalculator.compute(situatedView(wearParts));
      const wear = tyreWearCalculator.compute(situatedView({ ...wearParts, outputs: new Map([[TYRE_LIFE, tyreLife]]) }))[carId(0)]!;
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
        jumps: [{ at: 5_000, lap: 3, parts: ['rearWingPct' as const, 'floorPct' as const], deltaPct: 12, lossMsPerLap: unknown('insufficientData'), measuring: known({ lapsDone: 0, lapsNeeded: 2 }, 5_000), estimateMsPerLap: unknown('insufficientData') }],
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

    it('a new penalty for our car: critical, race, penaltyNew with the span\'s details, keyed by the span', () => {
      const [a, ...rest] = run(viewWith({}, { owes: { kind: 'driveThroughPending', id: 3, infringement: 7 }, history: { laps: [lap({ lapNumber: 1 })] } }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'penaltyNew',
        severity: 'critical',
        category: 'race',
        carId: carId(0),
        key: 'penaltyNew:0:3',
        params: { penalty: 'driveThrough', driveThroughs: 1, stopGos: 0, totalMs: 0, infringement: 7 },
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
      const l = lap({ lapNumber: 2 });
      l.channelRange.brakesC.fl = unknown('notReceived');
      l.channelRange.engineC = unknown('notReceived');
      expect(run(lapsView([l]))).toEqual([]);
    });

    it('the advisory changes at the end of a lap: raised when a lap ends out of band, resolved when the next ends in band', () => {
      const out = lapWith({ 'brakesC.fl': [180, 290] }, { lapNumber: 2 });
      const back = lapWith({}, { lapNumber: 3 });
      const book = new InsightBook();
      expect(book.apply(ALARMS, run(lapsView([])), 1_000)).toEqual([]);
      expect(book.apply(ALARMS, run(lapsView([out])), 90_000)).toEqual([{ type: 'raised', insight: expect.objectContaining({ key: 'bandOut:0:brakesC.fl' }) }]);
      expect(book.apply(ALARMS, run(lapsView([out])), 120_000)).toEqual([]);
      expect(book.apply(ALARMS, run(lapsView([out, back])), 180_000)).toEqual([{ type: 'resolved', key: 'bandOut:0:brakesC.fl', at: 180_000 }]);
    });
  });

  describe('band alarms judge representative laps and wait out the safety car (Q1)', () => {
    /** The race's session phase: `neutralised` by `car` with the stages seen so far, or `racing`. */
    const neutralised = (car: 'SC' | 'VSC', ...stages: NeutralisedStage[]) =>
      openSpan('session-phase-race', 'neutralised', { start: 300_000, detail: { car, stages: stages.map((stage, i) => ({ stage, at: 300_000 + i * 30_000 })) } });
    const racing = openSpan('session-phase-race', 'racing');
    // lap 3, the last clean lap before the SC: the rear-left carcass above its band (110-114 °C, mid 112 > 110)
    const preSc = lapWith({ 'tyre.carcassC.rl': [110, 114] }, { lapNumber: 3 });
    // lap 4 under the SC: the carcass cold (70-80 °C, below its band); not a rate lap
    const scLap = lapWith({ 'tyre.carcassC.rl': [70, 80] }, { lapNumber: 4, scShare: 1 });
    // car-bands' judgement of the pre-SC lap: the engine out of its band for the full lap
    const outLap = (): CarBands => ({ ...bandsOk(), engineC: reading('above', { outForFullLap: true }) });
    const BAND_KEYS = ['bandOut:0:tyre.carcassC.rl', 'bandOutLap:0:engineC'];
    const bandAlarms = (view: EngineView) => run(view).filter((i) => i.kind === 'bandOut' || i.kind === 'bandOutLap');
    const keysOf = (changes: ReturnType<InsightBook['apply']>) => changes.map((c) => [c.type, c.type === 'raised' ? c.insight.key : c.key]).sort();

    it('no band alarm from lap 1 of a race', () => {
      const over = { 'tyre.carcassC.rl': [110, 114], 'brakesC.fl': [180, 290] } as Record<string, [number, number]>;
      expect(run(lapsView([lapWith(over, { lapNumber: 1 })]))).toEqual([]);
      // the same lap as lap 2 is judged
      expect(run(lapsView([lapWith(over, { lapNumber: 2 })])).map((i) => i.key).sort()).toEqual(['bandOut:0:brakesC.fl', 'bandOut:0:tyre.carcassC.rl']);
    });

    it('only the race turns the lap-1 rule on: lap 1 of qualifying, practice or no weekend phase is judged like any rate lap', () => {
      const over = { 'tyre.carcassC.rl': [110, 114], 'brakesC.fl': [180, 290] } as Record<string, [number, number]>;
      for (const phase of [PRACTICE, QUALIFYING, NONE]) {
        expect(run(lapsView([lapWith(over, { lapNumber: 1 })], {}, { phase })).map((i) => i.key).sort(), phase.kind).toEqual(['bandOut:0:brakesC.fl', 'bandOut:0:tyre.carcassC.rl']);
      }
    });

    it('band alarms judge the newest clean lap: an SC or in-lap after it changes nothing', () => {
      expect(bandAlarms(lapsView([preSc, scLap])).map((i) => [i.key, i.params['state'], i.params['lap']])).toEqual([['bandOut:0:tyre.carcassC.rl', 'above', 3]]);
      const inLap = lapWith({ 'tyre.carcassC.rl': [70, 80] }, { lapNumber: 4, inLap: true });
      expect(bandAlarms(lapsView([preSc, inLap])).map((i) => [i.key, i.params['lap']])).toEqual([['bandOut:0:tyre.carcassC.rl', 3]]);
    });

    it('band alarms are hidden while the SC is deployed', () => {
      const book = new InsightBook();
      const before = book.apply(ALARMS, run(lapsView([preSc], { bands: outLap() }, { spans: [racing] })), 1_000);
      expect(keysOf(before)).toEqual(BAND_KEYS.map((k) => ['raised', k]));
      // the SC comes out: the pre-SC carcass alarm and the full-lap alarm are cleared
      const deployed = book.apply(ALARMS, run(lapsView([preSc], { bands: outLap() }, { spans: [neutralised('SC', 'deployed')] })), 2_000);
      expect(keysOf(deployed)).toEqual(BAND_KEYS.map((k) => ['resolved', k]));
      // an SC lap completes: still hidden
      expect(book.apply(ALARMS, run(lapsView([preSc, scLap], { bands: outLap() }, { spans: [neutralised('SC', 'deployed')] })), 3_000)).toEqual([]);
      // the VSC hides them the same
      expect(bandAlarms(lapsView([preSc, scLap], { bands: outLap() }, { spans: [neutralised('VSC', 'deployed')] }))).toEqual([]);
    });

    it('band alarms return at returning', () => {
      const book = new InsightBook();
      book.apply(ALARMS, run(lapsView([preSc], { bands: outLap() }, { spans: [racing] })), 1_000);
      book.apply(ALARMS, run(lapsView([preSc, scLap], { bands: outLap() }, { spans: [neutralised('SC', 'deployed')] })), 2_000);
      // "safety car in this lap": the same alarms raised again, judged from the pre-SC clean lap
      const returning = run(lapsView([preSc, scLap], { bands: outLap() }, { spans: [neutralised('SC', 'deployed', 'returning')] }));
      expect(keysOf(book.apply(ALARMS, returning, 3_000))).toEqual(BAND_KEYS.map((k) => ['raised', k]));
      expect(returning.find((i) => i.kind === 'bandOut')?.params).toMatchObject({ channel: 'tyre.carcassC.rl', state: 'above', lap: 3 });
      // the VSC's ending the same
      expect(bandAlarms(lapsView([preSc, scLap], { bands: outLap() }, { spans: [neutralised('VSC', 'deployed', 'returning')] })).map((i) => i.key).sort()).toEqual(BAND_KEYS);
      // racing again: a new clean lap in band replaces the pre-SC lap
      const clean = lapWith({}, { lapNumber: 5 });
      expect(bandAlarms(lapsView([preSc, scLap, clean], {}, { spans: [racing] }))).toEqual([]);
    });

    it('a damage alarm stays during the SC', () => {
      const damage = { ...damageOk(), jumps: [{ at: 305_000, lap: 5, parts: ['frontLeftWingPct' as const], deltaPct: 20, lossMsPerLap: unknown('insufficientData'), measuring: known({ lapsDone: 0, lapsNeeded: 2 }, 305_000), estimateMsPerLap: unknown('insufficientData') }] };
      const wear = wearOk();
      wear.corners.fl.lapsToLimit = known(2, 0);
      const fuel = { ...fuelOk(), marginLaps: known(-1, 0) };
      const view = lapsView([preSc, scLap], { bands: outLap(), damage, wear, fuel }, { lap: 5, warnings: 2, owes: { kind: 'timePenalty' }, spans: [neutralised('SC', 'deployed')] });
      // damage, fuel, wear, warnings and penalties are unaffected; only the band alarms are hidden
      expect(run(view).map((i) => i.kind).sort()).toEqual(['damageJump', 'fuelShort', 'penaltyNew', 'warningLast', 'wearLimitNear']);
    });

    it('no pressure alarm from an unknown band', () => {
      // car 0's setup not yet received: car-bands gives its pressure band and state unknown
      const unknownPressure = { value: known(25, 0), state: unknown('notReceived'), band: unknown('notReceived'), outForFullLap: false };
      const bands = bandsOk();
      for (const c of CORNER_IDS) bands.tyres[c].pressurePsi = unknownPressure;
      // a clean lap with every pressure far below any band and the rear-left carcass above its band
      const over = Object.fromEntries(CORNER_IDS.map((c) => [`tyre.pressurePsi.${c}`, [10, 12]])) as Record<string, [number, number]>;
      const found = run(lapsView([lapWith({ ...over, 'tyre.carcassC.rl': [110, 114] }, { lapNumber: 3 })], { bands }, { noSetup: true }));
      expect(found.filter((i) => i.key.includes('pressurePsi'))).toEqual([]);
      // the other channels are still judged
      expect(found.map((i) => i.key)).toEqual(['bandOut:0:tyre.carcassC.rl']);
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
      const damage = { ...damageOk(), jumps: [{ at: 5_000, lap: 3, parts: ['floorPct' as const], deltaPct: 9, lossMsPerLap: unknown('insufficientData'), measuring: known({ lapsDone: 0, lapsNeeded: 2 }, 5_000), estimateMsPerLap: unknown('insufficientData') }] };
      expect(only(viewWith({ damage }, { lap: 3 }), 'damageJump')).toHaveLength(1);
      expect(only(viewWith({ damage }, { lap: 4 }), 'damageJump')).toEqual([]);
    });

    it('a damage jump whose part is repaired on its lap goes away with the repair (through the damage calculator)', () => {
      const change = (at: number, fromPct: number, toPct: number) =>
        event({ kind: 'damageChange', carId: carId(0), at, params: { part: 'frontRightWingPct', fromPct, toPct } });
      // laps 1 and 2 complete at 90 s and 180 s; the hit and the wing change are both on lap 3
      const laps = [lap({ lapNumber: 1, completedAt: 90_000 }), lap({ lapNumber: 2, completedAt: 180_000 })];
      const damageOf = (events: ReturnType<typeof change>[]) =>
        damage.output(damage.init(situatedView({ cars: [carState({ timing: { lap: 3 } })], history: { events, laps } })))[carId(0)]!;
      const hit = change(200_000, 0, 40);
      expect(only(viewWith({ damage: damageOf([hit]) }, { lap: 3 }), 'damageJump')).toHaveLength(1);
      expect(only(viewWith({ damage: damageOf([hit, change(250_000, 40, 0)]) }, { lap: 3 }), 'damageJump')).toEqual([]);
    });

    it('a penalty lasts until our car completes its next lap (by frame), then resolves; another car\'s lap does not end it', () => {
      const owed: Owes = { kind: 'timePenalty', startFrame: 150 };
      const before = [lap({ lapNumber: 1, frame: 100 })];
      expect(only(viewWith({}, { owes: owed, history: { laps: before } }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { owes: owed, history: { laps: [...before, lap({ carId: carId(5), lapNumber: 2, frame: 200 })] } }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { owes: owed, history: { laps: [...before, lap({ lapNumber: 2, frame: 200 })] } }), 'penaltyNew')).toEqual([]);
    });

    it('membership is by frame, never by time: a lap completed later on the clock but on an earlier frame does not end it', () => {
      const owed: Owes = { kind: 'timePenalty', startFrame: 150 };
      const early = lap({ lapNumber: 1, frame: 100, completedAt: 900_000 });
      expect(only(viewWith({}, { owes: owed, history: { laps: [early] } }), 'penaltyNew')).toHaveLength(1);
    });

    it('a penalty before our first completed lap counts as new', () => {
      expect(only(viewWith({}, { owes: { kind: 'driveThroughPending' } }), 'penaltyNew')).toHaveLength(1);
    });

    it('a new span of what the car owes is a new alarm with another key (the spans of one car follow one another)', () => {
      const keyOf = (id: number, kind: Owes['kind']) => only(viewWith({}, { owes: { kind, id } }), 'penaltyNew').map((i) => i.key);
      expect(keyOf(0, 'timePenalty')).toEqual(['penaltyNew:0:0']);
      expect(keyOf(1, 'stopGoPending')).toEqual(['penaltyNew:0:1']);
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
    const rivalView = (parts: Parts, rivalCar = carState({ id: carId(5) })): EngineView =>
      engineView({
        cars: [carState(), rivalCar],
        outputs: outputsOf([outputsFor(0), outputsFor(5, parts)]),
        situation: situationOf([warned(2, 5), owes({ kind: 'timePenalty' }, 5)]),
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
      const withTeammate: EngineView = { ...view, live: { ...view.live, teammateCar: carId(5) } };
      expect(run(withTeammate).every((i) => i.carId === carId(5))).toBe(true);
      expect(run(withTeammate).map((i) => i.kind).sort()).toEqual(['bandOutLap', 'fuelShort', 'penaltyNew', 'warningLast', 'wearLimitNear']);
    });

    it('after a playerCar change the old car\'s alarms are resolved', () => {
      const parts = badEverything();
      const cars = [carState(), carState({ id: carId(1) })];
      const outputs = outputsOf([outputsFor(0, parts), outputsFor(1)]);
      const make = (playerCar: number) => engineView({ cars, outputs, playerCar, sessionTime: NOW, situation: situationOf([warned(2, 0), warned(0, 1)]) });
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
        wearAtStartPct: perCorner(() => known(46 + 3 * n, n * 90_000)),
        wearAtEndPct: perCorner(() => known(49 + 3 * n, n * 90_000)),
        fuelAtStartKg: known(13.5 - 1.5 * n, n * 90_000),
        fuelAtEndKg: known(12 - 1.5 * n, n * 90_000),
      }),
    );
  /** As the engine records the same laps of a car whose driver withholds the telemetry: the lap-end samples are restricted too. */
  const hiddenLaps = () =>
    teammateLaps().map((l) => ({
      ...l,
      wearAtStartPct: perCorner(() => restricted),
      wearAtEndPct: perCorner(() => restricted),
      fuelAtEndKg: restricted,
      fuelAtStartKg: restricted,
      ersStoreAtStartJ: restricted,
      ersStoreAtEndJ: restricted,
    }));
  /** The teammate on its 5-lap-old set with 65 % wear and 3 kg of fuel: 2 laps to the 70 % limit, 2 laps of fuel for 10 laps left. */
  const teammate = () =>
    carState({
      id: TEAMMATE,
      tyres: { age: 5, corners: perCorner(() => ({ wearPct: known(65, 0) })) },
      energy: { fuel: known({ kg: 3, capacityKg: 110, remainingLaps: 2, mix: 'standard' as const }, 0) },
    });

  /** The real upstream calculators over the view, then `alarms` over their outputs. */
  const chain = (car: ReturnType<typeof carState>, laps: ReturnType<typeof lap>[]) => {
    const remaining: SessionRemaining = { basis: 'laps', lapsLeft: known(10, 0), timeLeftMs: unknown('notApplicable') };
    const base = situatedView({ cars: [carState(), car], history: { laps }, sessionTime: NOW, outputs: new Map([[SESSION_REMAINING, remaining]]) });
    const view: EngineView = { ...base, live: { ...base.live, teammateCar: TEAMMATE } };
    const tyreLife = tyreLifeCalculator.compute(view);
    const outputs = new Map<string, unknown>([
      [SESSION_REMAINING, remaining],
      [TYRE_WEAR, tyreWearCalculator.compute({ ...view, outputs: new Map([[TYRE_LIFE, tyreLife]]) })],
      [FUEL, fuelCalculator.compute(view)],
      [ERS, ersCalculator.compute(view)],
      [CAR_BANDS, carBandsCalculator.compute(view)],
      [DAMAGE, damage.output(damage.init(view))],
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

describe('alarms behaviour table (C44)', () => {
  const config = { alarms: { warningsBeforePenalty: 3 } };

  it('has a row for exactly the kinds of the warnings, penalties and race session-phase sub-machines it reads', () => {
    const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
    expect(Object.keys(table).sort()).toEqual(['penalties', 'session-phase-race', 'warnings', 'weekend-phase']);
    expect(Object.keys(table['warnings']!).sort()).toEqual(['noWarning', 'warned']);
    expect(Object.keys(table['penalties']!).sort()).toEqual(['clear', 'driveThroughPending', 'stopGoPending', 'timePenalty']);
    expect(Object.keys(table['session-phase-race']!).sort()).toEqual(['finished', 'formation', 'grid', 'neutralised', 'postSession', 'racing', 'startLights', 'suspended']);
    expect(alarmsCalculator.reads).toEqual(expect.arrayContaining(['spans:warnings', 'spans:penalties', 'spans:session-phase-race', 'spans:weekend-phase']));
  });

  it('weekend phase: a row for exactly its kinds (C44)', () => {
    const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
    expect(Object.keys(table['weekend-phase']!).sort()).toEqual(['none', 'practice', 'qualifying', 'race']);
  });

  it('weekend phase: only race asks for the lap-1 rule and counts corner-cutting warnings; practice, qualifying and none ask for nothing', () => {
    const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
    expect(table['weekend-phase']).toEqual({ practice: {}, qualifying: {}, race: { isRace: true, warningCount: 'cornerCutting' }, none: {} });
  });

  it("weekend phase: the lap-1 rule is car-bands' row, so both judge the same lap (C43); car-bands counts no warnings", () => {
    const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
    expect(CAR_BANDS_BEHAVIOUR['weekend-phase']).toEqual({ practice: {}, qualifying: {}, race: { isRace: true }, none: {} });
    for (const [kind, row] of Object.entries(CAR_BANDS_BEHAVIOUR['weekend-phase']!)) {
      expect(table['weekend-phase']![kind], kind).toMatchObject(row);
      expect(table['weekend-phase']![kind]!.isRace, kind).toBe(row.isRace);
    }
  });

  it("today's penalty alarms are unchanged; the warning alarm counts corner-cutting warnings in a race", () => {
    // the rows, ported to one merged effect per kind (AlarmsEffect)
    const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
    // no warnings row names the total any more
    for (const [kind, effect] of Object.entries(table['warnings']!)) expect(effect.warningCount, kind).not.toBe('total');
    expect(table['penalties']).toEqual({
      clear: {},
      timePenalty: { penalty: 'time' },
      driveThroughPending: { penalty: 'driveThrough' },
      stopGoPending: { penalty: 'stopGo' },
    });
    // and what they raise
    const out = (o: ViewOpts) => run(viewWith({}, { config, ...o })).map((i) => [i.key, i.kind, i.severity, i.category, i.params]);
    expect(out({ warnings: 2 })).toEqual([['warningLast:0:warnings', 'warningLast', 'advisory', 'race', { warnings: 2, before: 3 }]]);
    expect(out({ warnings: 5 })).toEqual([['warningLast:0:warnings', 'warningLast', 'advisory', 'race', { warnings: 5, before: 3 }]]);
    for (const warnings of [0, 1, 3, 4]) expect(out({ warnings })).toEqual([]);
    expect(out({ owes: { kind: 'clear' } })).toEqual([]);
    expect(out({ owes: { kind: 'timePenalty', id: 1 } })).toEqual([['penaltyNew:0:1', 'penaltyNew', 'critical', 'race', { penalty: 'time', totalMs: 5000 }]]);
    expect(out({ owes: { kind: 'driveThroughPending', id: 2, infringement: 7 } })).toEqual([
      ['penaltyNew:0:2', 'penaltyNew', 'critical', 'race', { penalty: 'driveThrough', driveThroughs: 1, stopGos: 0, totalMs: 0, infringement: 7 }],
    ]);
    expect(out({ owes: { kind: 'stopGoPending', id: 3 } })).toEqual([
      ['penaltyNew:0:3', 'penaltyNew', 'critical', 'race', { penalty: 'stopGo', driveThroughs: 0, stopGos: 1, totalMs: 0 }],
    ]);
  });

  describe('session-phase-race', () => {
    // lap 3 a clean lap with the rear-left carcass above its band (110-114 °C, mid 112 > 110); the engine out for the full lap
    const hotLap = lapWith({ 'tyre.carcassC.rl': [110, 114] }, { lapNumber: 3 });
    const bands = (): CarBands => ({ ...bandsOk(), engineC: reading('above', { outForFullLap: true }) });
    const bandKeys = (span: OpenSpan) =>
      run(lapsView([hotLap], { bands: bands() }, { spans: [span] }))
        .filter((i) => i.kind === 'bandOut' || i.kind === 'bandOutLap')
        .map((i) => i.key)
        .sort();

    it('neutralised: one effect, the band alarms hidden; no other kind hides them', () => {
      const table: BehaviourTable<AlarmsEffect> = ALARMS_BEHAVIOUR;
      expect(table['session-phase-race']!['neutralised']).toEqual({ bandsHidden: true });
      for (const [kind, effect] of Object.entries(table['session-phase-race']!)) if (kind !== 'neutralised') expect(effect.bandsHidden).toBeUndefined();
    });

    for (const kind of ['grid', 'formation', 'startLights', 'racing', 'suspended', 'finished', 'postSession']) {
      it(`${kind}: the band alarms are raised`, () => {
        expect(bandKeys(openSpan('session-phase-race', kind))).toEqual(['bandOut:0:tyre.carcassC.rl', 'bandOutLap:0:engineC']);
      });
    }

    it('neutralised: the band alarms hidden until its stages hold returning', () => {
      const neutralised = (stages: NeutralisedStage[]) =>
        openSpan('session-phase-race', 'neutralised', { detail: { car: 'SC', stages: stages.map((stage, i) => ({ stage, at: 300_000 + i * 30_000 })) } });
      expect(bandKeys(neutralised(['deployed']))).toEqual([]);
      expect(bandKeys(neutralised(['deployed', 'returning']))).toEqual(['bandOut:0:tyre.carcassC.rl', 'bandOutLap:0:engineC']);
    });
  });

  describe('warnings', () => {
    it('noWarning: no warning alarm', () => {
      expect(only(viewWith({}, { warnings: 0, config }), 'warningLast')).toEqual([]);
    });

    it('warned: warningLast when one warning is left before the penalty, by the count the span holds', () => {
      expect(only(viewWith({}, { warnings: 2, config }), 'warningLast')).toHaveLength(1);
      expect(only(viewWith({}, { warnings: 1, config }), 'warningLast')).toEqual([]);
    });

    it('no span open: nothing (a car the machine has not covered yet raises no warning, never a zero reading)', () => {
      expect(only(viewWith({}, { config }), 'warningLast')).toEqual([]);
    });

    // Task 6c (Q4, user 2026-11-05): races only, corner-cutting warnings only, limit 3, the alarm at the 2nd
    it('a collision warning does not count toward the limit', () => {
      // cornerCutting 1 of 3, a collision warning besides: two warnings, one left only by the total
      expect(only(viewWith({}, { warnings: 2, cornerCutting: 1, config }), 'warningLast')).toEqual([]);
      // two collision warnings, no corner cutting
      expect(only(viewWith({}, { warnings: 2, cornerCutting: 0, config }), 'warningLast')).toEqual([]);
      // cornerCutting 2 of 3, a collision warning besides: the alarm, naming the corner-cutting count
      const alarm = only(viewWith({}, { warnings: 3, cornerCutting: 2, config }), 'warningLast');
      expect(alarm.map((i) => [i.key, i.severity, i.category, i.params])).toEqual([['warningLast:0:warnings', 'advisory', 'race', { warnings: 2, before: 3 }]]);
    });

    it('the limit is 3 corner-cutting warnings by default: the alarm at the 2nd', () => {
      expect(only(viewWith({}, { warnings: 2 }), 'warningLast').map((i) => i.params)).toEqual([{ warnings: 2, before: 3 }]);
      for (const cornerCutting of [1, 3]) expect(only(viewWith({}, { warnings: 4, cornerCutting }), 'warningLast'), String(cornerCutting)).toEqual([]);
    });

    it('no last-warning alarm in practice', () => {
      for (const o of [{ warnings: 2 }, { warnings: 3, cornerCutting: 2 }, { warnings: 5 }, { warnings: 8 }]) {
        expect(only(viewWith({}, { ...o, config, phase: PRACTICE }), 'warningLast'), JSON.stringify(o)).toEqual([]);
      }
    });

    it('no last-warning alarm in qualifying', () => {
      for (const o of [{ warnings: 2 }, { warnings: 3, cornerCutting: 2 }, { warnings: 5 }]) {
        expect(only(viewWith({}, { ...o, config, phase: QUALIFYING }), 'warningLast'), JSON.stringify(o)).toEqual([]);
      }
    });

    it('no last-warning alarm without a weekend phase (none)', () => {
      expect(only(viewWith({}, { warnings: 2, config, phase: NONE }), 'warningLast')).toEqual([]);
    });

    it('outside a race the other alarms are raised as in a race', () => {
      const wear = wearOk();
      wear.corners.fl.lapsToLimit = known(2, 0);
      for (const phase of [PRACTICE, QUALIFYING]) {
        expect(run(viewWith({ wear }, { warnings: 2, config, phase })).map((i) => i.kind), phase.kind).toEqual(['wearLimitNear']);
      }
    });

    // Task 24 (C13): the game's warning counts left the live state; a car without a warnings span is no warning
    it('reads the span of the car: a car without its warnings span is no warning', () => {
      const view = engineView({ cars: [carState()], outputs: outputsOf([outputsFor(0)]), config, sessionTime: NOW });
      expect(only(view, 'warningLast')).toEqual([]);
    });
  });

  describe('penalties', () => {
    const penalties = (kind: Owes['kind']) => only(viewWith({}, { owes: { kind } }), 'penaltyNew');

    it('clear: no penalty alarm', () => {
      expect(penalties('clear')).toEqual([]);
    });

    it('timePenalty: penaltyNew naming the time penalties in total', () => {
      expect(penalties('timePenalty').map((i) => i.params)).toEqual([{ penalty: 'time', totalMs: 5000 }]);
    });

    it('driveThroughPending: penaltyNew naming the drive-through, with the infringement when known', () => {
      expect(penalties('driveThroughPending').map((i) => i.params)).toEqual([{ penalty: 'driveThrough', driveThroughs: 1, stopGos: 0, totalMs: 0 }]);
    });

    it('stopGoPending: penaltyNew naming the stop-go', () => {
      expect(penalties('stopGoPending').map((i) => i.params)).toEqual([{ penalty: 'stopGo', driveThroughs: 0, stopGos: 1, totalMs: 0 }]);
    });

    it('no span open: nothing', () => {
      expect(only(viewWith({}), 'penaltyNew')).toEqual([]);
    });

  });

  it('judges each of our cars by its own spans', () => {
    const own = (id: number): CarId => carId(id);
    const view = engineView({
      cars: [carState(), carState({ id: own(1) })],
      outputs: outputsOf([outputsFor(0), outputsFor(1)]),
      playerCar: 0,
      sessionTime: NOW,
      config,
      situation: situationOf([warned(2, 1), owes({ kind: 'clear' }, 0), owes({ kind: 'timePenalty' }, 1)]),
    });
    const withTeammate: EngineView = { ...view, live: { ...view.live, teammateCar: own(1) } };
    expect(run(withTeammate).map((i) => i.key).sort()).toEqual(['penaltyNew:1:0', 'warningLast:1:warnings']);
  });
});
