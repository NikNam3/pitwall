// `strategy-dp`'s reaction table (SP4.3d1 Task 4, spec §5.2; C2, C43, C50): one world's solve as structured-cloneable
// typed arrays, queried for the averaged SC/VSC move at a state. How the queries are read is stated in
// `reaction-support.ts`, whose oracle reads the solve's own values.
import type { NoiseCompound, Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { solveDp, solveWorld } from '../../src/strategy-dp/index.ts';
import { continueFrom, nodeAlong, reactAt, reactionTable } from '../../src/strategy-dp/reaction.ts';
import { averagedMove, nodeOf, tyreAgeOf } from './reaction-support.ts';
import { dpInput } from './support.ts';

const LAPS = 20;
const CONDITIONS = ['sc', 'vsc'] as const;

/** An SC chance of 5 % and a VSC chance of 3 % on every lap, an SC of 1–4 laps, a VSC of 1–2. */
const HAZARD = {
  scByLap: Array.from({ length: LAPS }, () => 0.05),
  vscByLap: Array.from({ length: LAPS }, () => 0.03),
  scDur: [0.2, 0.3, 0.3, 0.2],
  vscDur: [0.5, 0.5],
};

/** A random stop list within `sets`: 0–3 stops on ascending laps before the flag. */
function randomPolicy(rng: ReturnType<typeof createRng>, sets: Record<string, number>): Policy {
  const left = { ...sets };
  const stops: Policy['stops'] = [];
  let lap = 0;
  const count = rng.int(0, 3);
  for (let k = 0; k < count && lap < LAPS - 1; k++) {
    lap = rng.int(lap + 1, LAPS - 1);
    const options = (['soft', 'medium', 'hard'] as NoiseCompound[]).filter((c) => (left[c] ?? 0) > 0);
    const compound = options[rng.int(0, options.length - 1)];
    if (compound === undefined) break;
    left[compound] = (left[compound] ?? 0) - 1;
    stops.push({ lap, compound });
  }
  return { stops };
}

describe('strategy-dp: the reaction table (SP4.3d1 Task 4, spec §5.2)', () => {
  // row 3
  it('equals the table: for 50 random states reactAt equals the argmin of the solve\'s averaged stay/box values', () => {
    const sets = { soft: 1, medium: 1, hard: 2 };
    const s = solveWorld(dpInput({ totalLaps: LAPS, car: { compound: 'medium', tyreAge: 4, degMsPerLap: { soft: 60, medium: 40, hard: 20 } }, sets, ...HAZARD }), 0);
    const t = reactionTable(s);
    // the jobs hand it to a worker thread
    const cloned = structuredClone(t);
    const rng = createRng(5);
    const moves = { stay: 0, box: 0 };
    for (let k = 0; k < 50; k++) {
      const policy = randomPolicy(rng, sets);
      const lap = rng.int(1, LAPS);
      const condition = CONDITIONS[rng.int(0, 1)] ?? 'sc';
      const node = nodeAlong(t, policy, lap);
      expect(node, `nodeAlong ${JSON.stringify(policy.stops)} at lap ${lap}`).toBe(nodeOf(s, policy, lap));
      const q = { lap, node, tyreAge: tyreAgeOf(s, policy, lap), condition };
      const expected = averagedMove(s, q);
      expect(reactAt(t, q), JSON.stringify({ ...q, stops: policy.stops })).toEqual(expected);
      expect(reactAt(cloned, q)).toEqual(expected);
      moves[expected === 'stay' ? 'stay' : 'box']++;
    }
    // both answers among the states, so the comparison means something
    expect(moves.box).toBeGreaterThan(0);
    expect(moves.stay).toBeGreaterThan(0);
  });

  it('continueFrom is the path walk: after boxThisLap\'s stop it gives boxThisLap\'s later stops, each at or after its lap', () => {
    const input = dpInput({ totalLaps: LAPS, car: { compound: 'medium', degMsPerLap: { soft: 60, medium: 80, hard: 20 } }, sets: { soft: 1, medium: 1, hard: 2 }, ...HAZARD });
    const s = solveWorld(input, 0);
    const t = reactionTable(s);
    // `boxThisLap` is the closed-loop play boxing at the end of `fromLap`, its stops where no neutralisation comes
    const box = solveDp(input).boxThisLap;
    if (box === null) throw new Error('no boxThisLap play');
    const [first, ...rest] = box.stops;
    expect(first?.lap).toBe(1);
    const policy: Policy = { stops: [first!] };
    const continued = continueFrom(t, { lap: 2, node: nodeAlong(t, policy, 2), tyreAge: 0 });
    expect(continued.stops).toEqual(rest);
    for (const lap of [5, 11, 17]) {
      const from = continueFrom(t, { lap, node: 0, tyreAge: lap - 1 });
      expect(from.stops.every((x: Policy['stops'][number]) => x.lap >= lap), `from lap ${lap}: ${JSON.stringify(from.stops)}`).toBe(true);
    }
  });

  // row 4
  it('no set, stops used: a car with no mediums left never boxes onto M; a car with MAX_STOPS used gets stay', () => {
    // mediums are the best tyre by far: with one set left the table boxes onto them
    const onSofts = (medium: number) => solveWorld(dpInput({ totalLaps: LAPS, car: { compound: 'soft', degMsPerLap: { soft: 80, medium: 10, hard: 40 } }, sets: { medium, hard: 1 }, ...HAZARD }), 0);
    const movesOf = (medium: number): ('stay' | NoiseCompound)[] => {
      const t = reactionTable(onSofts(medium));
      const out: ('stay' | NoiseCompound)[] = [];
      for (const policy of [{ stops: [] }, { stops: [{ lap: 5, compound: 'hard' as const }] }]) {
        for (let lap = 1; lap <= LAPS; lap++) {
          if (policy.stops.some((x) => x.lap >= lap)) continue;
          for (const condition of CONDITIONS) {
            const tyreAge = policy.stops.length === 0 ? lap - 1 : lap - 6;
            const m = reactAt(t, { lap, node: nodeAlong(t, policy, lap), tyreAge, condition });
            out.push(m === 'stay' ? 'stay' : m.box);
          }
        }
      }
      return out;
    };
    expect(movesOf(1)).toContain('medium');
    const none = movesOf(0);
    expect(none).not.toContain('medium');
    expect(none, 'it still boxes onto the hards it has').toContain('hard');

    // three stops made by lap 9: no box move on any later lap, whatever the condition
    const s = solveWorld(dpInput({ totalLaps: LAPS, car: { compound: 'soft', degMsPerLap: 80 }, sets: { soft: 2, medium: 2, hard: 2 }, ...HAZARD }), 0);
    const t = reactionTable(s);
    const three: Policy = { stops: [{ lap: 3, compound: 'soft' }, { lap: 6, compound: 'medium' }, { lap: 9, compound: 'hard' }] };
    const before = reactAt(t, { lap: 6, node: nodeAlong(t, three, 6), tyreAge: 2, condition: 'sc' });
    expect(before, 'with a stop left the same tyres box').not.toBe('stay');
    for (let lap = 10; lap <= LAPS; lap++) {
      for (const condition of CONDITIONS) expect(reactAt(t, { lap, node: nodeAlong(t, three, lap), tyreAge: lap - 10, condition }), `lap ${lap} ${condition}`).toBe('stay');
    }
  });
});
