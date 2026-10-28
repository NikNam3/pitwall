import type { CalculatorId } from '@pitwall/engine';
import type { SessionTime } from '@pitwall/domain';

/** How many of the latest runs the mean covers. */
const WINDOW = 100;

/** One calculator's timings, as published on `dev.calcStats`. */
export type CalcStat = { id: CalculatorId; lastMs: number; meanMs: number; runs: number; lastSessionTime: SessionTime };

export type CalcStats = {
  /** Pass as the scheduler's `onCalculatorRun`: times the run and returns its result; a run that throws is not recorded. */
  hook: <T>(id: CalculatorId, run: () => T) => T;
  /** The session time the following runs belong to. */
  atSessionTime: (time: SessionTime) => void;
  /** Every calculator that ran, sorted by id. */
  snapshot: () => CalcStat[];
};

type Timing = { durations: number[]; next: number; runs: number; lastMs: number; lastSessionTime: SessionTime };

/** Dev-mode timings per calculator. The clock lives here, in the shell: the engine reads none. */
export function createCalcStats(now: () => number = () => performance.now()): CalcStats {
  const records = new Map<CalculatorId, Timing>();
  let sessionTime: SessionTime = 0;
  return {
    hook: (id, run) => {
      const start = now();
      const result = run();
      const ms = now() - start;
      let record = records.get(id);
      if (record === undefined) {
        record = { durations: [], next: 0, runs: 0, lastMs: 0, lastSessionTime: sessionTime };
        records.set(id, record);
      }
      record.durations[record.next] = ms;
      record.next = (record.next + 1) % WINDOW;
      record.runs++;
      record.lastMs = ms;
      record.lastSessionTime = sessionTime;
      return result;
    },
    atSessionTime: (time) => {
      sessionTime = time;
    },
    snapshot: () =>
      [...records]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, r]) => ({
          id,
          lastMs: r.lastMs,
          meanMs: r.durations.reduce((sum, d) => sum + d, 0) / r.durations.length,
          runs: r.runs,
          lastSessionTime: r.lastSessionTime,
        })),
  };
}
