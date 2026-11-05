// `battle`'s PACE Δ window (live polish spec 3.1, C26, C43): both cars' times over the same last 50 mini-sectors,
// normalised to one lap; the window ends at the newest segment both cars have crossed. A segment is skipped when either
// car was in the pit lane or a neutralisation covered any frame of it, and the window reaches further back until it
// holds 50 usable segments, at most 3 laps back; fewer than `minPaceSegments` (25) usable give `insufficientData`.
// Positive = we are faster. Car 0 (ours) runs 1.8 s a segment from 1 s after car 1 (ahead), whose segments take
// 1.8 s + (segment mod 3) ms + (lap mod 2) ms: car 1 stays 0.6 to 1 s ahead, less than a segment, so a span boundary
// placed 100 ms after our crossing of a boundary falls into the same segment of both cars.
import { describe, expect, it } from 'vitest';
import type { Known, Ms } from '@pitwall/domain';
import { BATTLE_CONFIG } from '../../src/battle/index.ts';
import { cardOf, crossingAt, paceOver, segments, type Run, type Scene, type SegmentMs } from './race.ts';

const OURS: SegmentMs = () => 1800;
const THEIRS: SegmentMs = (lap, segment) => 1800 + (segment % 3) + (lap % 2);
const AHEAD: Run = { startAt: 0, ms: THEIRS };
const US: Run = { startAt: 1000, ms: OURS };
/** Our newest crossing: (4, 10); car 1's newest is (4, 10) too, 744 ms before it. */
const NOW = crossingAt(US, 4, 10);

const scene = (over: Partial<Scene> = {}): Scene => ({ now: NOW, runs: { 1: AHEAD, 0: US }, order: [1, 0], ...over });

/** PACE Δ of our card's ahead side. */
function paceAhead(s: Scene): Known<Ms> {
  const ahead = cardOf(s).ahead;
  if (!ahead.known) throw new Error('no car ahead');
  return ahead.value.paceDeltaMs;
}

const valueOf = (pace: Known<Ms>): number => {
  if (!pace.known) throw new Error(`PACE Δ unknown: ${pace.reason}`);
  return pace.value;
};

/** Our crossing of `(lap, segment)` plus 100 ms: inside that segment of both cars. */
const into = (lap: number, segment: number): number => crossingAt(US, lap, segment) + 100;

describe('battle: PACE Δ over the same last 50 mini-sectors (spec 3.1)', () => {
  it('two cars over 50 clean segments: PACE Δ is their time minus ours over the window, per lap', () => {
    // the window ends at segment (4, 9), the newest both crossed, and starts at (3, 10)
    const window = [...segments(3, 10, 49), ...segments(4, 0, 9)];
    expect(window).toHaveLength(50);
    const expected = paceOver(window, OURS, THEIRS);
    expect(expected).toBe(89);
    expect(paceAhead(scene())).toMatchObject({ known: true, value: expected });
  });

  it('a segment where either car is in the pit lane is skipped and the window reaches further back', () => {
    const s = scene({
      pitLane: [
        // ours in the pit lane over segments (3, 30) to (3, 34), theirs over (3, 40) to (3, 42)
        { car: 0, from: crossingAt(US, 3, 30) + 200, to: crossingAt(US, 3, 34) + 200 },
        { car: 1, from: crossingAt(AHEAD, 3, 40) + 200, to: crossingAt(AHEAD, 3, 42) + 200 },
      ],
    });
    const window = [...segments(3, 2, 29), ...segments(3, 35, 39), ...segments(3, 43, 49), ...segments(4, 0, 9)];
    expect(window).toHaveLength(50);
    expect(valueOf(paceAhead(s))).toBe(paceOver(window, OURS, THEIRS));
    expect(valueOf(paceAhead(s))).not.toBe(valueOf(paceAhead(scene())));
  });

  it('a segment an SC covers from its start crossing to its end crossing is skipped, also an SC that comes out mid-segment', () => {
    // a closed SC from inside segment (3, 20) to inside (3, 24): those five are skipped, the window starts at (3, 5)
    const closed = scene({ neutralised: [{ kind: 'SC', from: into(3, 20), to: into(3, 24) }] });
    const aroundIt = [...segments(3, 5, 19), ...segments(3, 25, 49), ...segments(4, 0, 9)];
    expect(aroundIt).toHaveLength(50);
    expect(valueOf(paceAhead(closed))).toBe(paceOver(aroundIt, OURS, THEIRS));

    // an SC still out, deployed inside segment (4, 5): (4, 5) to (4, 9) are skipped, the window ends at (4, 4)
    const out = scene({ neutralised: [{ kind: 'SC', from: into(4, 5) }] });
    const beforeIt = [...segments(3, 5, 49), ...segments(4, 0, 4)];
    expect(beforeIt).toHaveLength(50);
    expect(valueOf(paceAhead(out))).toBe(paceOver(beforeIt, OURS, THEIRS));
  });

  it('24 usable segments give insufficientData; 25, half a lap (minPaceSegments), give PACE Δ (Review Focus 3)', () => {
    // the first lap: our newest crossing (1, 24) closes our 24th segment
    expect(paceAhead(scene({ now: crossingAt(US, 1, 24) }))).toMatchObject({ known: false, reason: 'insufficientData' });
    // one crossing later: 25 segments, normalised to one lap
    const pace = paceAhead(scene({ now: crossingAt(US, 1, 25) }));
    expect(valueOf(pace)).toBe(paceOver(segments(1, 0, 24), OURS, THEIRS));
    expect(valueOf(pace)).toBe(98);
    // the threshold is the config's
    const lower = scene({ now: crossingAt(US, 1, 24), config: { [BATTLE_CONFIG.key]: { minPaceSegments: 20 } } });
    expect(valueOf(paceAhead(lower))).toBe(paceOver(segments(1, 0, 23), OURS, THEIRS));
  });

  it('at most 3 laps back: a long SC that leaves fewer than 25 usable segments in them gives insufficientData', () => {
    // our newest crossing (6, 0): the 3 laps back are laps 3 to 5; lap 2 is clean but out of reach
    const now = crossingAt(US, 6, 0);
    const long = scene({ now, neutralised: [{ kind: 'SC', from: into(3, 5), to: into(5, 44) }] });
    // usable within reach: (3, 0) to (3, 4) and (5, 45) to (5, 49), 10 segments
    expect(paceAhead(long)).toMatchObject({ known: false, reason: 'insufficientData' });

    // a shorter SC leaves 35 usable within reach: the window takes them, down to (3, 0) and no further
    const shorter = scene({ now, neutralised: [{ kind: 'SC', from: into(3, 30), to: into(5, 44) }] });
    const within = [...segments(3, 0, 29), ...segments(5, 45, 49)];
    expect(within).toHaveLength(35);
    expect(Math.abs(valueOf(paceAhead(shorter)) - paceOver(within, OURS, THEIRS))).toBeLessThanOrEqual(0.5);
  });

  it('a car a lap ahead is compared over the same segment indices of its own newest pass (Review Focus 2)', () => {
    // car 1 runs a lap ahead: we cross (L, s) 1 s or less after it crosses (L + 1, s)
    const lapUp: Run = { startAt: 0, ms: THEIRS };
    const us: Run = { startAt: crossingAt(lapUp, 2, 0) + 1000, ms: OURS };
    const s: Scene = { now: crossingAt(us, 4, 10), runs: { 1: lapUp, 0: us }, order: [1, 0] };
    // our window (3, 10) to (4, 9) against its (4, 10) to (5, 9)
    const window = [...segments(3, 10, 49), ...segments(4, 0, 9)];
    const expected = paceOver(window, OURS, THEIRS, (lap) => lap + 1);
    expect(expected).toBe(59);
    // its passes of the same lap numbers, a lap before, would give 89
    expect(paceOver(window, OURS, THEIRS)).not.toBe(expected);
    expect(paceAhead(s)).toMatchObject({ known: true, value: expected });
  });
});
