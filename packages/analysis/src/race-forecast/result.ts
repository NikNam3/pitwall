// The forecast's result (spec 6.3) from the cars' line times: positions, gaps and race times at the flag (or at the
// forecast's last lap), and the per-lap trace. Floating ms inside, integer ms out. A retired car has position 0 and
// gap and race time 0 (its position marks them as none).
import type { ForecastResult, ForecastTrace } from '@pitwall/domain';
import { lineIndex, type Field } from './field.ts';

const ms = (x: number): number => Math.round(x) + 0;

/** Car `c`'s time at the line ending `lap` (NaN if it never crossed it). */
const lineT = (f: Field, c: number, lap: number): number => f.lineT[lineIndex(f, c, lap)] ?? Number.NaN;

/**
 * Each car's finishing lap: at the flag the first line it crosses once the leader has finished (a lapped car one lap
 * or more short); at an earlier last lap that lap. -1 for a car retired before it.
 */
function finishLaps(f: Field, toFlag: boolean): Int16Array {
  const n = f.start.cars;
  const end = f.endLap;
  const finish = new Int16Array(n).fill(-1);
  let flagAt = Infinity;
  for (let c = 0; c < n; c++) if (f.running[c] === 1) flagAt = Math.min(flagAt, lineT(f, c, end));
  for (let c = 0; c < n; c++) {
    if (f.running[c] !== 1) continue;
    let lap = end;
    if (toFlag) while (lap > 0 && lineT(f, c, lap - 1) >= flagAt) lap--;
    finish[c] = lap;
  }
  return finish;
}

export function result(f: Field, toFlag: boolean, withTrace: boolean): ForecastResult {
  const n = f.start.cars;
  const finish = finishLaps(f, toFlag);
  const lapOf = (c: number): number => finish[c] ?? -1;
  const finishT = (c: number): number => lineT(f, c, lapOf(c));
  const classified = Array.from({ length: n }, (_, c) => c).filter((c) => lapOf(c) >= 0);
  classified.sort((a, b) => lapOf(b) - lapOf(a) || finishT(a) - finishT(b) || a - b);
  const position = new Int8Array(n);
  const gapMs = new Float64Array(n);
  const raceTimeMs = new Float64Array(n);
  const leaderT = classified.length > 0 ? finishT(classified[0] ?? 0) : 0;
  classified.forEach((c, k) => {
    position[c] = k + 1;
    gapMs[c] = ms(finishT(c) - leaderT);
    raceTimeMs[c] = ms(finishT(c));
  });
  const out: ForecastResult = { position, gapMs, raceTimeMs };
  if (withTrace) out.trace = trace(f, finish);
  return out;
}

/** Per lap from the starting lap: the cars that completed it (a car past its finish did not), by their line time. */
function trace(f: Field, finish: Int16Array): ForecastTrace {
  const n = f.start.cars;
  const entries: ForecastTrace = [];
  for (let lap = f.start.lap; lap <= f.endLap; lap++) {
    const crossed: number[] = [];
    for (let c = 0; c < n; c++) {
      const done = finish[c] ?? -1;
      if (!Number.isNaN(lineT(f, c, lap)) && (done < 0 || lap <= done)) crossed.push(c);
    }
    crossed.sort((a, b) => lineT(f, a, lap) - lineT(f, b, lap) || a - b);
    const position = new Int8Array(n);
    const gapMs = new Float64Array(n);
    const lapTimeMs = new Float64Array(n);
    const leaderT = crossed.length > 0 ? lineT(f, crossed[0] ?? 0, lap) : 0;
    crossed.forEach((c, k) => {
      const t = lineT(f, c, lap);
      const before = lineT(f, c, lap - 1);
      position[c] = k + 1;
      gapMs[c] = ms(t - leaderT);
      lapTimeMs[c] = Number.isNaN(before) ? 0 : ms(t - before);
    });
    entries.push({ lap, position, gapMs, lapTimeMs });
  }
  return entries;
}
