// `forecast-score` on real data (contract C84, SP4.3a spec 9, plan Task 19 row 11, ruling R15): the engine runs each
// segment of Task 22 frame by frame (`SessionTracker`, `SessionRunner`) and the test reads its final projection.
// Behaviour only, never the recording's values (C84):
//  - race-rejoin holds a green stop from its box release to 1.6 s into the out lap, not the in lap (R15): the stop is
//    recorded, green, no penalty, no repair, so a rejoin candidate, and the race order at its pit exit is measured,
//    holding every car once; the full rejoin case is on builder races (`experiments.test.ts`, `job.test.ts`);
//  - race-pass-braking-zone holds one pass into a braking zone, car 14 past car 0 (`docs/testing.md`); no lap completes
//    in its 8 s, so the pass is read from the segment's own mini-sector crossings: the two cars' order swaps once (R42).
import { currentCrossings, feedId, MINI_SECTORS } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type Projection, type StepResult } from '@pitwall/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { orderAtPitExit } from '../../src/forecast-score/experiments.ts';
import { CONFIG } from './support.ts';

const REJOIN = 'race-rejoin.pwrec.gz';
const PASS = 'race-pass-braking-zone.pwrec.gz';

/** The segment's final projection (its append frames included) and its track id. */
async function runSegment(file: string): Promise<{ history: Projection; trackId: number }> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  let last: { history: Projection; trackId: number } | undefined;
  const onResult = ({ state }: StepResult): void => {
    last = { history: state.history, trackId: state.session.trackId };
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  if (last === undefined) throw new Error(`${file}: the runner gave no state`);
  // The runner changes its state in place: a copy of what the test reads.
  return structuredClone(last);
}

let rejoin: { history: Projection; trackId: number };
let pass: { history: Projection; trackId: number };

describe('forecast-score on real data', () => {
  beforeAll(async () => {
    rejoin = await runSegment(REJOIN);
    pass = await runSegment(PASS);
  }, 120_000);

  it('segment race-rejoin gives one rejoin case; race-pass-braking-zone one pass, car 14 past car 0', () => {
    // race-rejoin: the green stop and the order measured at its pit exit (R15).
    const candidates = rejoin.history.pitStops.filter((s) => s.flag === 'green' && !s.penaltyServed && s.stationaryTimeMs <= CONFIG.repairStationaryMs);
    expect(candidates.length).toBeGreaterThan(0);
    for (const stop of candidates) {
      const order = orderAtPitExit(rejoin.history, stop);
      expect(order.known, `car ${stop.carId}`).toBe(true);
      if (!order.known) continue;
      expect(order.value.filter((c) => c === stop.carId), `car ${stop.carId}`).toHaveLength(1);
      expect(new Set(order.value).size).toBe(order.value.length);
    }

    // race-pass-braking-zone: car 14 passes car 0 (R42). No lap completes in the 8 s segment, so the pass is read from
    // the segment's own mini-sector crossings: over the (lap, segment) both cars crossed, car 0 leads first, car 14
    // last, and the order swaps exactly once (C25: the current crossings only).
    const crossings = currentCrossings(pass.history.crossings);
    const atOf = (car: number): Map<number, number> =>
      new Map(crossings.filter((c) => c.carId === car).map((c) => [c.lap * MINI_SECTORS + c.segment, c.at as number]));
    const behind = atOf(0);
    const passer = atOf(14);
    const shared = [...passer.keys()].filter((k) => behind.has(k)).sort((a, b) => a - b);
    expect(shared.length).toBeGreaterThan(1);
    const passerAhead = shared.map((k) => (passer.get(k) as number) < (behind.get(k) as number));
    expect(passerAhead[0]).toBe(false);
    expect(passerAhead.at(-1)).toBe(true);
    expect(passerAhead.filter((ahead, i) => i > 0 && ahead !== passerAhead[i - 1])).toHaveLength(1);
  });
});
