// The `pace` calculator: per car, the mean of the last `window` pace laps and of the current stint's pace laps.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type CurrentLaps, type LapRecord, type Ms, type StintRecord } from '@pitwall/domain';
import type { DeepReadonly, EngineView, IncrementalCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { stintLaps } from '../shared/stint-laps.ts';
import { PACE, PACE_CONFIG, type Pace } from './index.ts';

type PaceAcc = {
  laps: CurrentLaps;
  /** Each car's last closed stint (the engine records a stint when it closes). */
  lastStint: Array<DeepReadonly<StintRecord> | undefined>;
  isRace: boolean;
  window: number;
};

const foldStints = (acc: PaceAcc, view: EngineView, from: number): void => {
  const stints = view.state.history.stints;
  for (const s of stints.slice(from)) acc.lastStint[s.carId] = s;
};

const foldLaps = (acc: PaceAcc, view: EngineView, from: number): void => {
  addLaps(acc.laps, view.state.history.laps.slice(from) as LapRecord[]);
};

const settings = (view: EngineView) => ({ isRace: view.state.session.kind === 'race', window: PACE_CONFIG.read(view).window });

const mean = (laps: LapRecord[]) => {
  const newest = laps[laps.length - 1] as LapRecord;
  const value = Math.round(laps.reduce((sum, l) => sum + (l.lapTimeMs as number), 0) / laps.length) as Ms;
  return known(value, newest.completedAt);
};

const init = (view: EngineView): PaceAcc => {
  const acc: PaceAcc = { laps: emptyCurrentLaps(), lastStint: [], ...settings(view) };
  foldLaps(acc, view, 0);
  foldStints(acc, view, 0);
  return acc;
};

export const paceCalculator: IncrementalCalculator<PaceAcc, Pace> = {
  id: PACE,
  kind: 'incremental',
  reads: ['laps', 'stints', 'session'],
  cadence: 'lapCompleted',
  init,
  update(acc, delta, view) {
    if (delta.truncated) return init(view);
    Object.assign(acc, settings(view));
    foldLaps(acc, view, delta.before.laps);
    foldStints(acc, view, delta.before.stints);
    return acc;
  },
  output(acc) {
    const byCar: Pace['byCar'] = {};
    acc.laps.forEach((byLap, id) => {
      if (byLap === undefined) return;
      const all = Object.values(byLap).sort((a, b) => a.lapNumber - b.lapNumber);
      if (all.length === 0) return;
      const pace = all.filter((l) => classifyLap(l, acc).forPace);
      const stint = stintLaps(all, acc.lastStint[id]).filter((l) => classifyLap(l, acc).forPace);
      const recent = pace.slice(-acc.window);
      byCar[id as CarId] = {
        recentMs: recent.length > 0 ? mean(recent) : unknown('insufficientData'),
        stintMs: stint.length > 0 ? mean(stint) : unknown('insufficientData'),
        samples: recent.length,
      };
    });
    return { byCar };
  },
};
