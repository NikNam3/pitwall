// The `pace` calculator: per car, the mean of the last `window` pace laps and of the current stint's pace laps.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type CurrentLaps, type LapRecord, type Ms, type StintRecord } from '@pitwall/domain';
import type { DeepReadonly, EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { stintLaps } from '../shared/stint-laps.ts';
import { PACE_BEHAVIOUR, type PaceEffect } from './behaviour.ts';
import { PACE, PACE_CONFIG, type Pace } from './index.ts';

type PaceAcc = {
  laps: CurrentLaps;
  /** Each car's last closed stint (the engine records a stint when it closes). */
  lastStint: Array<DeepReadonly<StintRecord> | undefined>;
};

const foldStints = (acc: PaceAcc, view: EngineView, from: number): void => {
  const stints = view.history.stints;
  for (const s of stints.slice(from)) acc.lastStint[s.carId] = s;
};

const foldLaps = (acc: PaceAcc, view: EngineView, from: number): void => {
  addLaps(acc.laps, view.history.laps.slice(from) as LapRecord[]);
};

/**
 * The weekend phase's row (`PACE_BEHAVIOUR`; `notApplicable` when the phase has no pace, C14) and the config. A pending
 * weekend phase has no span yet and reads as the race's grid (C14): its row is the race's. Read by `output`, never kept
 * in the accumulator (C31.2).
 */
const settings = (view: EngineView) => ({
  ...(Object.assign({}, PACE_BEHAVIOUR['weekend-phase']?.race, ...behaviourFor(PACE_BEHAVIOUR, view)) as Required<PaceEffect>),
  ...LAP_CLASSES_CONFIG.read(view),
  window: PACE_CONFIG.read(view).window,
});

const mean = (laps: LapRecord[]) => {
  const newest = laps[laps.length - 1] as LapRecord;
  const value = Math.round(laps.reduce((sum, l) => sum + (l.lapTimeMs as number), 0) / laps.length) as Ms;
  return known(value, newest.completedAt);
};

const init = (view: EngineView): PaceAcc => {
  const acc: PaceAcc = { laps: emptyCurrentLaps(), lastStint: [] };
  foldLaps(acc, view, 0);
  foldStints(acc, view, 0);
  return acc;
};

export const paceCalculator: IncrementalCalculator<PaceAcc, Pace> = {
  id: PACE,
  kind: 'incremental',
  reads: ['laps', 'stints', 'spans:weekend-phase'],
  cadence: 'lapCompleted',
  init,
  update(acc, delta, view) {
    if (delta.rewound !== undefined) return init(view);
    foldLaps(acc, view, delta.before.laps ?? 0);
    foldStints(acc, view, delta.before.stints ?? 0);
    return acc;
  },
  output(acc, view) {
    const set = settings(view);
    const byCar: Pace['byCar'] = {};
    acc.laps.forEach((byLap, id) => {
      if (byLap === undefined) return;
      const all = Object.values(byLap).sort((a, b) => a.lapNumber - b.lapNumber);
      if (all.length === 0) return;
      if (set.notApplicable) {
        const na = unknown('notApplicable');
        byCar[id as CarId] = { recentMs: na, stintMs: na, samples: 0 };
        return;
      }
      const pace = all.filter((l) => classifyLap(l, set).forPace);
      const stint = stintLaps(all, acc.lastStint[id]).filter((l) => classifyLap(l, set).forPace);
      const recent = pace.slice(-set.window);
      byCar[id as CarId] = {
        recentMs: recent.length > 0 ? mean(recent) : unknown('insufficientData'),
        stintMs: stint.length > 0 ? mean(stint) : unknown('insufficientData'),
        samples: recent.length,
      };
    });
    return { byCar };
  },
};
