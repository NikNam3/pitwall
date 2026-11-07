// Hand-built `rejoin.car` and `rejoin.ghostLines` values for the gap chart's tests and gallery (SP4.2 spec 3.2, 4;
// mockup docs/design/2026-10-30-sp4a-displays/1-ghost-views.html). Test-phase file: the implementer does not edit it.
// The losses are the mockup's: green 20.3 s measured this session, VSC 13.1 s from the calibration, SC 9.8 s a default.
import type { CarId, EstimateSource, GhostLines, Ms, PitCondition, Rejoin, RejoinAt } from '@pitwall/domain';
import { carId, known, unknown } from '@pitwall/domain';

/** The three conditions in the order the chart names them. */
export const GHOST_CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

/** The mockup's losses per condition, ms. */
export const LOSS_MS: Record<PitCondition, Ms> = { green: 20_300, vsc: 13_100, sc: 9_800 };

/** The mockup's sources: measured (no mark), calibration (ᶜ), default (ᵈ). */
export const LOSS_SOURCE: Record<PitCondition, EstimateSource> = {
  green: { kind: 'session', sessionShare: 1, parts: '6 stops' },
  vsc: { kind: 'calibration', setName: 'Silverstone dry', sources: 3, sessionShare: 0, parts: 'calibration' },
  sc: { kind: 'default', note: 'community value, Silverstone (R3)', sessionShare: 0, parts: 'default' },
};

/** One condition of `rejoin.car`: only the loss and its source matter to the gap chart. */
const rejoinAt = (condition: PitCondition, lossMs: RejoinAt['lossMs']): RejoinAt => ({
  condition,
  lossMs,
  lossSource: LOSS_SOURCE[condition],
  rejoinPosition: known(12, 0),
  order: unknown('insufficientData'),
  mapPoint: unknown('notApplicable'),
});

/** `rejoin.car` of `car`, every loss known unless `losses` overrides one. */
export const rejoinOf = (car: CarId, losses: Partial<Record<PitCondition, RejoinAt['lossMs']>> = {}): Rejoin => ({
  carId: car,
  position: 6,
  conditions: {
    green: rejoinAt('green', losses.green ?? known(LOSS_MS.green, 0)),
    vsc: rejoinAt('vsc', losses.vsc ?? known(LOSS_MS.vsc, 0)),
    sc: rejoinAt('sc', losses.sc ?? known(LOSS_MS.sc, 0)),
  },
});

/**
 * `rejoin.ghostLines` for `cars`: each car's gapper line `step * lap` ms over laps `from` to `to` plus each condition's
 * loss, one point per lap; `steps[i]` belongs to `cars[i]`.
 */
export const ghostLinesOf = (cars: readonly CarId[], steps: readonly number[], from: number, to: number): GhostLines => ({
  lines: cars.flatMap((car, i) =>
    GHOST_CONDITIONS.map((condition) => ({
      carId: car,
      condition,
      points: Array.from({ length: to - from + 1 }, (_, k) => ({ lap: from + k, gapMs: (steps[i] ?? 0) * (from + k) + LOSS_MS[condition] })),
    })),
  ),
});

/** The gallery's player KUH (id 0) and teammate ZHO (id 1). */
export const KUH = carId(0);
export const ZHO = carId(1);
