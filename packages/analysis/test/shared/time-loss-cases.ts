// The three time-loss cases of SP4.3c Task 4 (B6, spec §5.3 O6): one slow mini-sector of car 7 (a human) on lap 5,
// under green, inside a confirmed SC span, and inside the car's pit visit. `driver-noise` and `incidents` read the same
// views, so the one exclusion rule (`timeLossExcludedOf`, membership by the projection module, C26) gives both the same
// events. The views are `incidents`' test races (`../incidents/race.ts`) with what `driver-noise` needs on top: car 7's
// lap records (each describing its line crossing's frame), its car-driver span `human`, its car-status span
// `competing`, and `degradation`'s and `track-wetness`'s outputs (every lap's residual 0, a dry track).
import { carId, type CarId, type LapRecord, type MiniSectorCrossing } from '@pitwall/domain';
import { asOfNow, type EngineView } from '@pitwall/engine/readers';
import { lap, neutralisation } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { DRIVER_NOISE } from '../../src/driver-noise/index.ts';
import { carModelsOf } from '../../src/driver-noise/residuals.ts';
import { TRACK_WETNESS } from '../../src/track-wetness/index.ts';
import { dryWetness, stintOf } from '../driver-noise/support.ts';
import { boundaryAt, chain, LAPS, location, race, SEGMENT_MS, status, viewOf, type Delay } from '../incidents/race.ts';

/** Car 7, the human of the cases. */
export const HUMAN: CarId = carId(7);

/** Car 7's slow mini-sector: lap 5, segment 10, 2.5 s slower than its median. */
const SLOW: Delay = { carId: HUMAN, lap: 5, segment: 10, ms: 2_500 };
/** Where it starts: car 7's crossing (5, 10), on the frame numbered by its time (`race`). */
export const SLOW_START = boundaryAt(7, 5, 10);
/** Where it ends: car 7's crossing (5, 11). */
export const SLOW_END = SLOW_START + SEGMENT_MS + SLOW.ms;
/** Its loss against the car's median. */
export const SLOW_LOSS_MS = SLOW.ms;

/** The time-loss thresholds: the `incidents` and `damage` config defaults (as `driver-noise` reads them). */
export const TIME_LOSS = { timeLossMs: 2_000, mergeMs: 5_000, jumpPct: 5, jumpWindowMs: 2_000 };

/** `driver-noise`'s residual config: its defaults and the time-loss thresholds. */
export const RESIDUAL_CONFIG = { freeAirGapMs: 1_500, rejoinSkipLaps: 2, mistakeSigmas: 3, bigEventMs: 5_000, timeLoss: TIME_LOSS };

/** Car 7's lap records 1..LAPS, each completed at (and describing the frame of) its next lap's line crossing. */
function humanLaps(crossings: readonly MiniSectorCrossing[]): LapRecord[] {
  return Array.from({ length: LAPS }, (_, i) => i + 1).map((n) => {
    const line = crossings.find((c) => c.carId === HUMAN && c.lap === n + 1 && c.segment === 0);
    const start = crossings.find((c) => c.carId === HUMAN && c.lap === n && c.segment === 0);
    if (line === undefined || start === undefined) throw new Error(`time-loss cases: no crossing for lap ${n}`);
    return lap({ carId: HUMAN, lapNumber: n, lapTimeMs: line.at - start.at, completedAt: line.at, frame: line.frame, positionAtEnd: 8 });
  });
}

export type TimeLossCase = 'green' | 'sc' | 'pitVisit';

/** Car 7's human model of `driver-noise` in a case, through the guarded view of what the unit declares (C41). */
export const humanModelOf = (kind: TimeLossCase) => {
  const view = guardedView(timeLossCase(kind), driverNoiseCalculator.reads, { unit: DRIVER_NOISE });
  const car = carModelsOf(asOfNow(view), RESIDUAL_CONFIG).get(HUMAN);
  if (car === undefined) throw new Error('driver-noise: no car 7');
  return car.models.human;
};

/** The view of one case: the slow mini-sector under green, inside a confirmed SC, or inside car 7's pit visit. */
export function timeLossCase(kind: TimeLossCase): EngineView {
  const miniSectors = race({ delays: [SLOW] });
  const sc = neutralisation({ kind: 'SC', start: SLOW_START - 10_000, end: SLOW_START + 30_000, id: 1 });
  const visit = location(7, [
    { kind: 'pitLane', at: SLOW_START - 1_000 },
    { kind: 'track', at: SLOW_START + 20_000 },
  ]);
  const driver = chain('car-driver', 7, [{ kind: 'human', at: 0, joinedAt: true }]);
  const view = viewOf({
    miniSectors,
    laps: humanLaps(miniSectors),
    phases: kind === 'sc' ? [sc] : [],
    spans: [...driver, ...status(7), ...(kind === 'pitVisit' ? visit : [])],
  });
  const outputs = new Map(view.outputs);
  outputs.set(DEGRADATION, { [HUMAN]: [stintOf({ car: 7, to: LAPS })] });
  outputs.set(TRACK_WETNESS, dryWetness(LAPS));
  return { ...view, outputs };
}
