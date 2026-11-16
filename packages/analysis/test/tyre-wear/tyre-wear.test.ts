// `tyre-wear` (spec 4.2, the port, C43): a thin analysis that publishes `tyreWear.car` from `tyre-life`'s output. The
// rate and laps-to-limit cases that were here moved with the judgement to `test/tyre-life/` (C82); what stays is what the
// topic shape asserts: the `TyreWear` value from a given `tyre-life` output, and `warnLaps` from the alarms config.
import { carId, known, unknown, type CarId, type Known, type TyreWear } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../../src/tyre-life/index.ts';
import { TYRE_WEAR } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';

/** The analysis through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(tyreWearCalculator);

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
  // ported in SP4.3c Task 12: tyre-life's `basis`, `ageLossLimitMs` and `freshLifeLaps` are deleted (spec §5.2)
  limitPct: 65,
  gameLifeSpanLaps: known(22, 1_000),
  ...over,
});

/** A rival whose wear realism hides: every corner `unknown('realism')`. */
const hiddenCorner = (): TyreLife['corners']['fl'] => ({ wearPct: hidden, ratePctPerLap: hidden, lapsToLimit: hidden });
const hiddenLife = (): TyreLife =>
  life({
    corners: { fl: hiddenCorner(), fr: hiddenCorner(), rl: hiddenCorner(), rr: hiddenCorner() },
    lapsToLimit: known(8, 0),
    gameLifeSpanLaps: hidden,
  });

/** Cars 0, 3 and 5 in the session; `tyre-life`'s output as `view.outputs` holds it. */
const viewOf = (tyreLife: TyreLifeOutput, config: EngineView['config'] = {}): EngineView =>
  situatedView({
    cars: [carState({ id: carId(0) }), carState({ id: carId(3) }), carState({ id: carId(5) })],
    outputs: new Map([[TYRE_LIFE, tyreLife]]),
    config,
  });

/**
 * The wear a corner reaches at the game's life span (B1, the formula moved from `tyre-life-bar/rows.ts`): its rate ×
 * the life span, at the rate's time; unknown with the rate's reason while the rate is unknown, else the life span's.
 */
const atLifeSpan = (rate: Known<number>, lifeSpan: Known<number>): Known<number> =>
  !rate.known ? rate : !lifeSpan.known ? lifeSpan : known(rate.value * lifeSpan.value, rate.at);

/** What `tyreWear.car` holds for a car with `tyre-life` entry `l`: its corners, its limit and life span, the marker, and `warnLaps`. */
const projected = (l: TyreLife, warnLaps: number): TyreWear => ({
  corners: l.corners,
  limitPct: l.limitPct,
  warnLaps,
  gameLifeSpanLaps: l.gameLifeSpanLaps,
  wearAtLifeSpanPct: {
    fl: atLifeSpan(l.corners.fl.ratePctPerLap, l.gameLifeSpanLaps),
    fr: atLifeSpan(l.corners.fr.ratePctPerLap, l.gameLifeSpanLaps),
    rl: atLifeSpan(l.corners.rl.ratePctPerLap, l.gameLifeSpanLaps),
    rr: atLifeSpan(l.corners.rr.ratePctPerLap, l.gameLifeSpanLaps),
  },
});

/** One corner as the `tyre-life-bar` gallery builds it (`apps/ui/src/widgets/tyre-life-bar/gallery.ts`). */
const galleryCorner = (wearPct: number, rate: number, laps: number) => ({
  wearPct: known(wearPct, 100), ratePctPerLap: known(rate, 100), lapsToLimit: known(laps, 100),
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

  // B1 (C43, C65): the life-span marker is tyre-wear's judgement; the display draws the field as given.
  it('wearAtLifeSpanPct equals the old widget`s marker (rate x life span) on the tyre-life-bar gallery fixture', () => {
    // The gallery's late stint (rates 1.9, 2, 1.6, 1.7 %/lap) on a 22-lap life span: the old widget drew 1.9 x 22 % etc.
    const lateStint = life({
      corners: { fl: galleryCorner(61, 1.9, 4), fr: galleryCorner(66, 2, 2), rl: galleryCorner(57, 1.6, 8), rr: galleryCorner(60, 1.7, 5) },
      gameLifeSpanLaps: known(22, 100),
    });
    const out = calc.compute(viewOf({ [carId(0)]: lateStint }))[carId(0)]!;
    expect(out.wearAtLifeSpanPct).toEqual({
      fl: known(1.9 * 22, 100),
      fr: known(2 * 22, 100),
      rl: known(1.6 * 22, 100),
      rr: known(1.7 * 22, 100),
    });
    // The rates' time, not the life span's: the marker moves with the rate.
    const later = life({ corners: { ...lateStint.corners, fl: { ...galleryCorner(61, 1.9, 4), ratePctPerLap: known(1.9, 5_000) } }, gameLifeSpanLaps: known(22, 100) });
    expect(calc.compute(viewOf({ [carId(0)]: later }))[carId(0)]!.wearAtLifeSpanPct.fl).toEqual(known(1.9 * 22, 5_000));
  });

  it('wearAtLifeSpanPct is unknown with the rate`s reason while the rate is unknown, else with the life span`s', () => {
    // life(): rl has no rate yet (insufficientData); the others have one, on a known 22-lap life span.
    const out = calc.compute(viewOf({ [carId(0)]: life() }))[carId(0)]!;
    expect(out.wearAtLifeSpanPct.rl).toEqual(insufficient);
    expect(out.wearAtLifeSpanPct.fl).toEqual(known(2 * 22, 90_000));
    // The game gives no life span: every corner with a rate is unknown for the life span's reason.
    const noLife = calc.compute(viewOf({ [carId(0)]: life({ gameLifeSpanLaps: unknown('notReceived') }) }))[carId(0)]!;
    expect(noLife.wearAtLifeSpanPct.fl).toEqual(unknown('notReceived'));
    expect(noLife.wearAtLifeSpanPct.rl).toEqual(insufficient);
    // Realism hides the rival's wear: its marker is hidden too.
    const rival = calc.compute(viewOf({ [carId(3)]: hiddenLife() }))[carId(3)]!;
    expect(Object.values(rival.wearAtLifeSpanPct)).toEqual([hidden, hidden, hidden, hidden]);
  });

  it('warnLaps follows the alarms config override', () => {
    const out = calc.compute(viewOf({ [carId(0)]: life() }, { alarms: { wearLapsWarning: 5 } }));
    expect(out[carId(0)]).toEqual(projected(life(), 5));
  });
});
