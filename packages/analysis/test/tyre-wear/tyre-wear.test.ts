// `tyre-wear` (spec 4.2, the port, C43): a thin analysis that publishes `tyreWear.car` from `tyre-life`'s output. The
// rate and laps-to-limit cases that were here moved with the judgement to `test/tyre-life/` (C82); what stays is what the
// topic shape asserts: the `TyreWear` value from a given `tyre-life` output, and `warnLaps` from the alarms config.
import { carId, known, unknown, type CarId, type Known, type TyreWear, type VisualCompound } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../../src/tyre-life/index.ts';
import { TYRE_WEAR } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';

/** The analysis through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(tyreWearCalculator);

const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly VisualCompound[];
const hidden = unknown('realism');
const insufficient = unknown('insufficientData');

/** One car's `tyre-life` entry (spec 4.2): a wear limit of 65 % (not the default 70, so a limit of tyre-wear's own shows). */
const life = (over: Partial<TyreLife> = {}): TyreLife => ({
  corners: {
    fl: { wearPct: known(20, 0), ratePctPerLap: known(2, 90_000), lapsToLimit: known(22.5, 90_000) },
    fr: { wearPct: known(24, 0), ratePctPerLap: known(3, 90_000), lapsToLimit: known(41 / 3, 90_000) },
    rl: { wearPct: known(12, 0), ratePctPerLap: insufficient, lapsToLimit: insufficient },
    rr: { wearPct: known(66, 0), ratePctPerLap: known(4, 90_000), lapsToLimit: known(0, 0) },
  },
  lapsToLimit: known(0, 0),
  basis: 'wear',
  limitPct: 65,
  ageLossLimitMs: 2000,
  freshLifeLaps: Object.fromEntries(COMPOUNDS.map((c) => [c, known(25, 0)])) as Record<VisualCompound, Known<number>>,
  gameLifeSpanLaps: known(22, 1_000),
  ...over,
});

/** A rival whose wear realism hides: age basis, every corner `unknown('realism')`. */
const hiddenCorner = (): TyreLife['corners']['fl'] => ({ wearPct: hidden, ratePctPerLap: hidden, lapsToLimit: hidden });
const hiddenLife = (): TyreLife =>
  life({
    corners: { fl: hiddenCorner(), fr: hiddenCorner(), rl: hiddenCorner(), rr: hiddenCorner() },
    lapsToLimit: known(8, 0),
    basis: 'age',
    gameLifeSpanLaps: hidden,
  });

/** Cars 0, 3 and 5 in the session; `tyre-life`'s output as `view.outputs` holds it. */
const viewOf = (tyreLife: TyreLifeOutput, config: EngineView['config'] = {}): EngineView =>
  situatedView({
    cars: [carState({ id: carId(0) }), carState({ id: carId(3) }), carState({ id: carId(5) })],
    outputs: new Map([[TYRE_LIFE, tyreLife]]),
    config,
  });

/** What `tyreWear.car` holds for a car with `tyre-life` entry `l`: its corners, its limit and life span, and `warnLaps`. */
const projected = (l: TyreLife, warnLaps: number): TyreWear => ({
  corners: l.corners,
  limitPct: l.limitPct,
  warnLaps,
  gameLifeSpanLaps: l.gameLifeSpanLaps,
});

describe('tyre-wear analysis', () => {
  it('is the quick unit `tyre-wear` at 4 Hz over tyre-life`s output, not the session', () => {
    expect(tyreWearCalculator.id).toBe(TYRE_WEAR);
    expect(tyreWearCalculator.kind).toBe('quick');
    expect(tyreWearCalculator.cadence).toEqual({ hz: 4 });
    expect(tyreWearCalculator.reads).toContainEqual({ calculator: TYRE_LIFE });
    expect(tyreWearCalculator.reads).not.toContain('session');
  });

  it('tyre-wear`s output equals the projection of tyre-life`s for every car', () => {
    // car 5 is in the live state but has no tyre-life entry (tyre-life decided it is not in the session): no entry here
    const tyreLife: TyreLifeOutput = { [carId(0)]: life(), [carId(3)]: hiddenLife() };
    const out = calc.compute(viewOf(tyreLife));
    const expected: Record<CarId, TyreWear> = {
      [carId(0)]: projected(life(), 3),
      [carId(3)]: projected(hiddenLife(), 3),
    };
    expect(out).toEqual(expected);
    expect(out[carId(5)]).toBeUndefined();
    // an empty tyre-life output (no car in the session yet) gives an empty output
    expect(calc.compute(viewOf({}))).toEqual({});
  });

  it('warnLaps is the alarms config default (3)', () => {
    expect(calc.compute(viewOf({ [carId(0)]: life() }))[carId(0)]!.warnLaps).toBe(3);
  });

  it('warnLaps follows the alarms config override', () => {
    const out = calc.compute(viewOf({ [carId(0)]: life() }, { alarms: { wearLapsWarning: 5 } }));
    expect(out[carId(0)]).toEqual(projected(life(), 5));
  });
});
