// Timing on race-zandvoort-full-lap (facts in fixtures/index.json): our gaps at the line against the game's, and the
// line times the gapper draws its lines from. One replay through the engine and `gaps` feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import { GAPS, gapperLines, gapsCalculator, type GapsOutput } from '@pitwall/analysis';
import type { CarId, Interval, MiniSectorCrossing } from '@pitwall/domain';
import type { DeepReadonly, EngineState } from '@pitwall/engine';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

/** A LapData frame on which the game sent a new value of one of a car's gaps, and the car's position then. */
type Refresh = { at: number; valueMs: number; position: number };
type GameGap = 'gapToCarAheadMs' | 'gapToLeaderMs';
/** A line crossing and our interval of the car on the frame that recorded it. */
type LineCrossing = { crossing: MiniSectorCrossing; ours: Interval | undefined };

const run: {
  state: DeepReadonly<EngineState>;
  last: GapsOutput;
  /** Per `carId:field`, the game's refreshes of that gap, in time order. */
  refreshes: Map<string, Refresh[]>;
  lines: LineCrossing[];
} = {} as never;

beforeAll(async () => {
  const refreshes = new Map<string, Refresh[]>();
  const lines: LineCrossing[] = [];
  let last: GapsOutput | undefined;
  const runner = await replayScheduled(segmentPath('race-zandvoort-full-lap.pwrec.gz'), [gapsCalculator], ({ state, delta }, scheduled, frame) => {
    last = scheduled.outputs.get(GAPS) as GapsOutput;
    for (const m of state.history.miniSectors.slice(delta.before.miniSectors)) {
      if (m.segment === 0) lines.push({ crossing: { ...m }, ours: structuredClone(last.intervals.find((i) => i.carId === m.carId)) });
    }
    if (!frame.lapData) return;
    for (const car of state.cars) {
      if (!car.active) continue;
      for (const field of ['gapToCarAheadMs', 'gapToLeaderMs'] as const) {
        const gap = car.timing[field];
        if (!gap.known) continue;
        const list = refreshes.get(`${car.id}:${field}`) ?? [];
        refreshes.set(`${car.id}:${field}`, list);
        if (list.at(-1)?.valueMs !== gap.value) list.push({ at: state.sessionTime, valueMs: gap.value, position: car.timing.position });
      }
    }
  });
  Object.assign(run, { state: runner.state, last: last!, refreshes, lines });
});

/**
 * The game's gap of `carId` at session time `at`. The game does not refresh `deltaToCarInFront` and
 * `deltaToRaceLeader` at the line: it sends a new value about every 0.5 s per car (the leader gap on its own tick),
 * and the LapData frames between repeat it. So the value on the crossing frame can be up to a second old, and the
 * game's gap at the line lies between its last refresh at or before the line and its first refresh after it; we take
 * it linearly in time between the two. `undefined` when the segment lacks either refresh, or when the car's position
 * changed between them (an overtake at the line changes the car the game measures to).
 */
function gameGapAt(carId: CarId, field: GameGap, at: number): number | undefined {
  const list = run.refreshes.get(`${carId}:${field}`) ?? [];
  const after = list.findIndex((r) => r.at > at);
  const before = after < 0 ? undefined : list[after - 1];
  const next = list[after];
  if (before === undefined || next === undefined || before.position !== next.position) return undefined;
  return before.valueMs + ((next.valueMs - before.valueMs) * (at - before.at)) / (next.at - before.at);
}

describe("race-zandvoort-full-lap: our gaps against the game's at the line", () => {
  it("at each line crossing of a car on the leader's lap, our gaps to the car ahead and to the leader are the game's within 100 ms", () => {
    const compared: string[] = [];
    const off: string[] = [];
    for (const { crossing, ours } of run.lines) {
      if (ours === undefined || ours.lapsDown !== 0) continue;
      for (const [field, gap] of [['gapToCarAheadMs', ours.toAheadMs], ['gapToLeaderMs', ours.toLeaderMs]] as const) {
        const game = gameGapAt(crossing.carId, field, crossing.at);
        if (!gap.known || game === undefined) continue;
        compared.push(`${crossing.carId}:${field}`);
        if (Math.abs(gap.value - game) > 100) off.push(`car ${crossing.carId} lap ${crossing.lap} ${field}: ours ${gap.value}, game ${Math.round(game)}`);
      }
    }
    expect(compared).not.toEqual([]);
    expect(off).toEqual([]);
  });
});

describe('race-zandvoort-full-lap: the line times the gapper draws from', () => {
  it("each car's line times are its line crossings, one per completed lap, in lap and time order with no lap missing", () => {
    for (const car of run.state.cars.filter((c) => c.active)) {
      const crossed = run.state.history.miniSectors.filter((m) => m.carId === car.id && m.segment === 0 && m.lap >= 2);
      const times = run.last.lineTimes[car.id] ?? [];
      expect(times, `car ${car.id}`).toEqual(crossed.map((m) => ({ lap: m.lap - 1, at: m.at })));
      times.forEach((t, i) => {
        const before = times[i - 1];
        if (before !== undefined) expect([t.lap - before.lap, t.at > before.at], `car ${car.id}`).toEqual([1, true]);
      });
    }
  });

  it('joined after lights out, the gapper draws no line for any car and says why: the race start is notReceived', () => {
    expect(run.last.raceStartAt).toEqual({ known: false, reason: 'notReceived' });
    for (const reference of [{ kind: 'leaderAverage' }, { kind: 'fixed', lapMs: 75_000 }] as const) {
      const lines = gapperLines(run.last, reference);
      expect(lines.cars.filter((c) => c.byLap.length > 0).map((c) => c.carId), reference.kind).toEqual([]);
    }
    expect(gapperLines(run.last, { kind: 'leaderAverage' }).referenceLapMs).toEqual({ known: false, reason: 'notReceived' });
  });
});
