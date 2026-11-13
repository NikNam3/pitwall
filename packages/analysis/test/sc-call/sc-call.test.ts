// `sc-call` (SP4.2 spec 3.3, 6.1): per our car, per condition SC and VSC, the rejoin position (from `rejoin`), the stop's
// loss with its source (from `pit-loss`) and the gain against a green stop, `loss[green] − loss[c]` (positive = good).
// Builder data; `rejoin`'s and `pit-loss`'s outputs are passed explicitly; every case runs through the guarded view
// (C41); race only, a pending phase reads as the race (C14).
import {
  carId,
  known,
  SPAN_DECLARATIONS,
  unknown,
  type EstimateSource,
  type Known,
  type Ms,
  type PitCondition,
  type PitLosses,
  type PitLossEstimate,
  type Rejoin,
  type RejoinAt,
  type WeekendPhase,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { REJOIN, type RejoinOutput } from '../../src/rejoin/index.ts';
import {
  SC_CALL_42_BEHAVIOUR as SC_CALL_BEHAVIOUR,
  scCallCalculator,
  type ScCall42 as ScCall,
  type ScCall42Output as ScCallOutput,
  type ScCall42Row as ScCallRow,
} from '../../src/sc-call/calculator.ts';
import { SC_CALL } from '../../src/sc-call/index.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';

const calc = guardedQuick(scCallCalculator);

/** Our car (the player's, `playerCar` 0) and a rival. */
const US = 0;
const RIVAL = 1;

const SESSION_SOURCE: EstimateSource = { kind: 'session', sessionShare: 1, parts: 'session' };
const DEFAULT_SOURCE: EstimateSource = { kind: 'default', note: 'track file', sessionShare: 0, parts: 'default' };
const CALIBRATION_SOURCE: EstimateSource = { kind: 'calibration', setName: 'Monza dry', sources: 4, sessionShare: 0, parts: 'calibration' };

const estimate = (lossMs: Known<Ms>, source: EstimateSource): PitLossEstimate => ({ lossMs, inLapShare: unknown('notReceived'), stationaryMedianMs: known(2_500, 0), sessionStops: 3, source });

/** The losses of case 1: green 20 300 (session), SC 9 800 (default), VSC 13 100 (calibration). */
type Losses = Record<PitCondition, Known<Ms>>;
const LOSSES: Losses = { green: known(20_300, 0), sc: known(9_800, 0), vsc: known(13_100, 0) };
const SOURCES: Record<PitCondition, EstimateSource> = { green: SESSION_SOURCE, sc: DEFAULT_SOURCE, vsc: CALIBRATION_SOURCE };

const pitLosses = (losses: Losses): PitLosses => ({
  conditions: {
    green: estimate(losses.green, SOURCES.green),
    sc: estimate(losses.sc, SOURCES.sc),
    vsc: estimate(losses.vsc, SOURCES.vsc),
  },
  stops: [],
});

/** `rejoin`'s value of one car: its rejoin positions per condition, the same losses as `pit-loss`'s. */
function rejoinOf(car: number, positions: Record<PitCondition, Known<number>>, losses: Losses): Rejoin {
  const at = (condition: PitCondition): RejoinAt => ({
    condition,
    lossMs: losses[condition],
    lossSource: SOURCES[condition],
    rejoinPosition: positions[condition],
    order: unknown('insufficientData'),
    mapPoint: unknown('notApplicable'),
  });
  return { carId: carId(car), position: 8, conditions: { green: at('green'), sc: at('sc'), vsc: at('vsc') } };
}

type Case = {
  losses?: Losses;
  /** Our rejoin positions (default green 12, SC 9, VSC 10). */
  positions?: Record<PitCondition, Known<number>>;
  /** Our car is absent from `rejoin`'s cars (in the pit lane). */
  ourRejoinAbsent?: boolean;
  /** `rejoin` holds the rival too (it never should: the rival stays absent here). */
  rivalInRejoin?: boolean;
  phase?: WeekendPhase;
};

const POSITIONS: Record<PitCondition, Known<number>> = { green: known(12, 0), sc: known(9, 0), vsc: known(10, 0) };

function view(c: Case = {}): EngineView {
  const losses = c.losses ?? LOSSES;
  const positions = c.positions ?? POSITIONS;
  const cars: RejoinOutput['cars'] = {};
  if (c.ourRejoinAbsent !== true) cars[carId(US)] = rejoinOf(US, positions, losses);
  if (c.rivalInRejoin === true) cars[carId(RIVAL)] = rejoinOf(RIVAL, positions, losses);
  const rejoin: RejoinOutput = { cars, ghost: { gaps: {} as RejoinOutput['ghost']['gaps'], losses, ourCars: [carId(US)], ghostLaps: 6 } };
  return situatedView({
    phase: c.phase ?? RACE,
    cars: [carState({ id: carId(US) }), carState({ id: carId(RIVAL) })],
    outputs: new Map<string, unknown>([
      [REJOIN, rejoin],
      [PIT_LOSS, pitLosses(losses)],
    ]),
  });
}

const outOf = (c: Case = {}): ScCallOutput => calc.compute(view(c));

/** Our car's `scCall.car` value; throws when it is absent. */
function ours(c: Case = {}): ScCall {
  const out = outOf(c)[carId(US)];
  if (out === undefined) throw new Error('no sc call for our car');
  return out;
}

const row = (s: ScCall, condition: 'sc' | 'vsc'): ScCallRow => {
  const r = s.rows.find((x) => x.condition === condition);
  if (r === undefined) throw new Error(`no ${condition} row`);
  return r;
};

const v = <T>(value: T) => ({ known: true, value });
const INSUFFICIENT = unknown('insufficientData');
const NOT_RECEIVED = unknown('notReceived');

describe('sc-call calculator', () => {
  it('is the quick calculator `sc-call` on our crossings over rejoin, pit-loss and the weekend phase', () => {
    expect(scCallCalculator.id).toBe(SC_CALL);
    expect(scCallCalculator.kind).toBe('quick');
    expect(scCallCalculator.cadence).toBe('ourCrossing');
    expect([...scCallCalculator.reads]).toEqual(expect.arrayContaining([{ calculator: REJOIN }, { calculator: PIT_LOSS }, 'spans:weekend-phase']));
    expect(scCallCalculator.reads).toHaveLength(3);
  });

  // 1
  it('losses green 20 300, SC 9 800 (default), VSC 13 100 (calibration), rejoin SC 9, VSC 10: rows [sc: 9, 9 800, +10 500], [vsc: 10, 13 100, +7 200], sources passed through', () => {
    const s = ours();
    expect(s.carId).toBe(carId(US));
    expect(s.rows.map((r) => r.condition)).toEqual(['sc', 'vsc']);
    const sc = row(s, 'sc');
    expect(sc.rejoinPosition).toMatchObject(v(9));
    expect(sc.lossMs).toMatchObject(v(9_800));
    expect(sc.lossSource).toEqual(DEFAULT_SOURCE);
    expect(sc.gainMs).toMatchObject(v(10_500));
    const vsc = row(s, 'vsc');
    expect(vsc.rejoinPosition).toMatchObject(v(10));
    expect(vsc.lossMs).toMatchObject(v(13_100));
    expect(vsc.lossSource).toEqual(CALIBRATION_SOURCE);
    expect(vsc.gainMs).toMatchObject(v(7_200));
  });

  // 2
  it('green loss unknown: both gainMs unknown with its reason; an SC loss unknown: that row’s lossMs and gainMs unknown', () => {
    const noGreen = ours({ losses: { ...LOSSES, green: INSUFFICIENT } });
    expect(row(noGreen, 'sc').gainMs).toEqual(INSUFFICIENT);
    expect(row(noGreen, 'vsc').gainMs).toEqual(INSUFFICIENT);
    expect(row(noGreen, 'sc').lossMs).toMatchObject(v(9_800));
    expect(row(noGreen, 'vsc').lossMs).toMatchObject(v(13_100));

    const noSc = ours({ losses: { ...LOSSES, sc: NOT_RECEIVED } });
    expect(row(noSc, 'sc').lossMs).toEqual(NOT_RECEIVED);
    expect(row(noSc, 'sc').gainMs).toEqual(NOT_RECEIVED);
    expect(row(noSc, 'vsc').lossMs).toMatchObject(v(13_100));
    expect(row(noSc, 'vsc').gainMs).toMatchObject(v(7_200));
  });

  it('the rejoin positions are rejoin’s, an unknown one included', () => {
    const s = ours({ positions: { green: known(12, 0), sc: INSUFFICIENT, vsc: known(10, 0) } });
    expect(row(s, 'sc').rejoinPosition).toEqual(INSUFFICIENT);
    expect(row(s, 'vsc').rejoinPosition).toMatchObject(v(10));
  });

  // 3
  describe('3: our cars, the race only, the guarded view, the behaviour table', () => {
    it('rejoin absent for our car (in the pit lane): absent here', () => {
      const out = outOf({ ourRejoinAbsent: true });
      expect(Object.hasOwn(out, carId(US))).toBe(false);
      expect(Object.keys(out)).toEqual([]);
    });

    it('a rival is absent from the output', () => {
      const out = outOf({ rivalInRejoin: true });
      expect(Object.hasOwn(out, carId(RIVAL))).toBe(false);
      expect(Object.keys(out)).toEqual([String(US)]);
    });

    it('outside the race our car is absent (notApplicable through the binding); a pending phase reads as the race', () => {
      for (const phase of [QUALIFYING, PRACTICE, NONE]) expect(outOf({ phase })).toEqual({});
      expect(row(ours({ phase: { kind: 'pending' } }), 'sc').gainMs).toMatchObject(v(10_500));
    });

    it('runs through the guarded view: reads rejoin, pit-loss and weekend-phase only', () => {
      // `calc` is the guarded calculator: a read it does not declare throws
      expect(() => calc.compute(view())).not.toThrow();
      expect(() => calc.compute(view({ ourRejoinAbsent: true, rivalInRejoin: true }))).not.toThrow();
    });

    it('the behaviour table: weekend-phase race → race, others notApplicable', () => {
      expect(SC_CALL_BEHAVIOUR['weekend-phase']).toEqual({
        race: { race: true },
        practice: { notApplicable: true },
        qualifying: { notApplicable: true },
        none: { notApplicable: true },
      });
    });

    it('the behaviour table is complete over the machines it reads', () => {
      const read = scCallCalculator.reads.flatMap((r) => (typeof r === 'string' && r.startsWith('spans:') ? [r.slice('spans:'.length)] : []));
      expect(Object.keys(SC_CALL_BEHAVIOUR).sort()).toEqual([...read].sort());
      for (const machine of read) {
        const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
        expect(Object.keys(SC_CALL_BEHAVIOUR[machine] ?? {}).sort()).toEqual([...kinds].sort());
      }
    });
  });
});
