// The `pace` calculator: per car, the mean of the last `window` pace laps and of the current stint's pace laps.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type CurrentLaps, type LapRecord, type Ms } from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { PACE, PACE_CONFIG, type Pace } from './index.ts';

type PaceAcc = {
  laps: CurrentLaps;
  /** First lap of each car's current stint (the greatest `firstLap` seen). */
  stintStart: Array<number | undefined>;
  isRace: boolean;
  window: number;
};

const foldStints = (acc: PaceAcc, view: EngineView, from: number): void => {
  const stints = view.state.history.stints;
  for (let i = from; i < stints.length; i++) {
    const s = stints[i];
    if (s !== undefined && s.firstLap > (acc.stintStart[s.carId] ?? -Infinity)) acc.stintStart[s.carId] = s.firstLap;
  }
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
  const acc: PaceAcc = { laps: emptyCurrentLaps(), stintStart: [], ...settings(view) };
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
      const stintStart = acc.stintStart[id] ?? -Infinity;
      const stint = pace.filter((l) => l.lapNumber >= stintStart);
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
