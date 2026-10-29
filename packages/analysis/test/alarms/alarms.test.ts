import { carId, known, unknown, type CarBands, type DamageState, type FuelState, type Insight, type TyreWear } from '@pitwall/domain';
import { InsightBook, type EngineView, type History } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { ALARMS } from '../../src/alarms/index.ts';
import { alarmsCalculator } from '../../src/alarms/calculator.ts';
import { CAR_BANDS } from '../../src/car-bands/index.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import { ERS } from '../../src/ers/index.ts';
import { FUEL } from '../../src/fuel/index.ts';
import { TYRE_WEAR } from '../../src/tyre-wear/index.ts';
import { carState, engineView, event, lap, realismHidden } from '../../../../test-support/builders/index.ts';

// Assumptions pinned here (see the test report): key = `${kind}:${carId}:${channel}`; channel names `tyre.<surfaceC|carcassC|pressurePsi>.<corner>`,
// `brakesC.<corner>`, `engineC`, `wear.<corner>`, `fuel`, `warnings`; `damageJump` and `penaltyNew` use the jump's / event's session time as channel;
// `compute` returns the active alarms and `insights` returns them unchanged; raisedAt = view.state.sessionTime.

const perCorner = <T>(make: () => T) => ({ fl: make(), fr: make(), rl: make(), rr: make() });
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
    ...(o.config && { config: o.config }),
    ...(o.playerCar !== undefined && { playerCar: o.playerCar }),
  });

const run = (view: EngineView): Insight[] => alarmsCalculator.insights!(alarmsCalculator.compute(view), undefined, view);
const only = (view: EngineView, kind: string) => run(view).filter((i) => i.kind === kind);

describe('alarms calculator', () => {
  it('is the quick calculator `alarms` at 2 Hz reading the five analyses and the car state', () => {
    expect(alarmsCalculator.id).toBe(ALARMS);
    expect(alarmsCalculator.kind).toBe('quick');
    expect(alarmsCalculator.cadence).toEqual({ hz: 2 });
    expect(alarmsCalculator.reads).toEqual(
      expect.arrayContaining([TYRE_WEAR, FUEL, ERS, CAR_BANDS, DAMAGE].map((calculator) => ({ calculator }))),
    );
    expect(alarmsCalculator.reads).toEqual(expect.arrayContaining(['timing', 'events']));
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

    it('a brake or engine channel out of band for a full lap: critical, damage', () => {
      const bands = bandsOk();
      bands.brakesC.rr = reading('below', { outForFullLap: true });
      bands.engineC = reading('above', { outForFullLap: true });
      const found = run(viewWith({ bands }));
      expect(found.map((i) => [i.key, i.kind, i.severity, i.category]).sort()).toEqual([
        ['bandOutLap:0:brakesC.rr', 'bandOutLap', 'critical', 'damage'],
        ['bandOutLap:0:engineC', 'bandOutLap', 'critical', 'damage'],
      ]);
    });

    it('a tyre channel out of band now, not for a full lap: advisory, tyres, bandOut with state and value', () => {
      const bands = bandsOk();
      bands.tyres.rr.pressurePsi = reading('above', { value: 33 });
      const [a, ...rest] = run(viewWith({ bands }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'bandOut',
        severity: 'advisory',
        category: 'tyres',
        key: 'bandOut:0:tyre.pressurePsi.rr',
        params: { channel: 'tyre.pressurePsi.rr', state: 'above', value: 33, lo: 85, hi: 105 },
      });
    });

    it('a brake or engine channel out of band now: advisory, damage', () => {
      const bands = bandsOk();
      bands.brakesC.fl = reading('below', { value: 200 });
      bands.engineC = reading('above', { value: 140 });
      const found = run(viewWith({ bands }));
      expect(found.map((i) => [i.key, i.kind, i.severity, i.category]).sort()).toEqual([
        ['bandOut:0:brakesC.fl', 'bandOut', 'advisory', 'damage'],
        ['bandOut:0:engineC', 'bandOut', 'advisory', 'damage'],
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
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { penaltyType: 'timePenalty', infringementType: 'cornerCutting', timeMs: 5000, lap: 2 } });
      const [a, ...rest] = run(viewWith({}, { history: { laps: [lap({ lapNumber: 1 })], events: [penalty] } }));
      expect(rest).toEqual([]);
      expect(a).toMatchObject({
        kind: 'penaltyNew',
        severity: 'critical',
        category: 'race',
        carId: carId(0),
        key: 'penaltyNew:0:100000',
        params: { penaltyType: 'timePenalty', infringementType: 'cornerCutting', timeMs: 5000, lap: 2 },
      });
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

    it('follows the config: with 4, three warnings raise it and two do not', () => {
      const config = { alarms: { warningsBeforePenalty: 4 } };
      expect(only(viewWith({}, { warnings: 3, config }), 'warningLast')).toHaveLength(1);
      expect(only(viewWith({}, { warnings: 2, config }), 'warningLast')).toEqual([]);
    });
  });

  describe('resolution', () => {
    it('an alarm resolves when its condition ends', () => {
      const bad = bandsOk();
      bad.engineC = reading('above');
      const book = new InsightBook();
      const first = book.apply(ALARMS, run(viewWith({ bands: bad })), 1_000);
      expect(first).toEqual([{ type: 'raised', insight: expect.objectContaining({ key: 'bandOut:0:engineC', raisedAt: 1_000 }) }]);
      expect(book.apply(ALARMS, run(viewWith({ bands: bad })), 2_000)).toEqual([]);
      expect(book.apply(ALARMS, run(viewWith({ bands: bandsOk() })), 3_000)).toEqual([{ type: 'resolved', key: 'bandOut:0:engineC', at: 3_000 }]);
    });

    it('a channel that gets worse resolves bandOut and raises bandOutLap under a different key', () => {
      const early = bandsOk();
      early.engineC = reading('above');
      const late = bandsOk();
      late.engineC = reading('above', { outForFullLap: true });
      const book = new InsightBook();
      book.apply(ALARMS, run(viewWith({ bands: early })), 1);
      const changes = book.apply(ALARMS, run(viewWith({ bands: late })), 2);
      expect(changes.map((c) => (c.type === 'raised' ? c.insight.key : c.key))).toEqual(['bandOut:0:engineC', 'bandOutLap:0:engineC']);
    });

    it('a damage jump lasts for its lap and resolves on the next', () => {
      const damage = { ...damageOk(), jumps: [{ at: 5_000, lap: 3, parts: ['floorPct' as const], deltaPct: 9, lossMsPerLap: unknown('insufficientData') }] };
      expect(only(viewWith({ damage }, { lap: 3 }), 'damageJump')).toHaveLength(1);
      expect(only(viewWith({ damage }, { lap: 4 }), 'damageJump')).toEqual([]);
    });

    it('a penalty lasts until our car completes its next lap, then resolves; another car\'s lap does not end it', () => {
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { lap: 2 } });
      const hist = (laps: ReturnType<typeof lap>[]) => ({ laps, events: [penalty] });
      const before = [lap({ lapNumber: 1 })];
      expect(only(viewWith({}, { history: hist(before) }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { history: hist([...before, lap({ carId: carId(5), lapNumber: 2, completedAt: 180_000 })]) }), 'penaltyNew')).toHaveLength(1);
      expect(only(viewWith({}, { history: hist([...before, lap({ lapNumber: 2 })]) }), 'penaltyNew')).toEqual([]);
    });

    it('a penalty before our first completed lap counts as new', () => {
      const penalty = event({ kind: 'penalty', carId: carId(0), at: 1_000, params: { lap: 1 } });
      expect(only(viewWith({}, { history: { events: [penalty] } }), 'penaltyNew')).toHaveLength(1);
    });

    it('two penalties in one lap are two alarms with different keys', () => {
      const events = [
        event({ kind: 'penalty', carId: carId(0), at: 100_000, params: { lap: 2 } }),
        event({ kind: 'penalty', carId: carId(0), at: 120_000, params: { lap: 2 } }),
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
        history: { events: [event({ kind: 'penalty', carId: carId(5), at: 1_000, params: { lap: 1 } })] },
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
