// `race-monte-carlo`: our SC/VSC reaction is the DP's averaged move (SP4.3d1 Task 4, spec §5.2; C2, C43, C50). In each
// scenario, on the first lap of each SC or VSC, each of our cars with a reaction table (`McInput.reactions[slot]`) asks
// it once at the plan's state: `stay` keeps the plan (a planned stop inside the neutralisation stays), a box onto a
// compound boxes at the end of that lap and then follows `continueFrom` from the next lap instead of the plan's later
// stops; no second choice within one neutralisation. How the table's queries are read: `../strategy-dp/reaction-support.ts`.
//
// The tables are built from `strategy-dp`'s test inputs (`../strategy-dp/support.ts`), solved alone: a table is an input
// of the simulator, so it need not be the starting point's own solve. Our car (slot 0) leads a rival 60 s behind with no
// stop ahead; the field is quiet, so every scenario with the same neutralisations is the one forecast (as Task 3's play
// tests read it).
import type { Policy, StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { raceMonteCarlo, scoreAll } from '../../src/race-monte-carlo/index.ts';
import { solveWorld } from '../../src/strategy-dp/index.ts';
import { continueFrom, nodeAlong, reactAt, reactionTable, type ReactionTable } from '../../src/strategy-dp/reaction.ts';
import { drawn, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { dpInput } from '../strategy-dp/support.ts';
import { carOf, hazard, mcInput, NO_STOP, rowOf, stopAt } from './support.ts';

const LAPS = 20;

/** An SC chance of 5 % and a VSC chance of 3 % on every lap, an SC of 1–4 laps, a VSC of 1–2 (the DP's averaging). */
const DP_HAZARD = {
  scByLap: Array.from({ length: LAPS }, () => 0.05),
  vscByLap: Array.from({ length: LAPS }, () => 0.03),
  scDur: [0.2, 0.3, 0.3, 0.2],
  vscDur: [0.5, 0.5],
};

/** A medium-shod car whose mediums fade fast and hards hardly: under an SC on laps 1–16 its table boxes onto hards. */
const tableA = (): ReactionTable =>
  reactionTable(solveWorld(dpInput({ totalLaps: LAPS, car: { compound: 'medium', degMsPerLap: { soft: 80, medium: 80, hard: 10 } }, sets: { hard: 1, medium: 1 }, ...DP_HAZARD }), 0));

/** A milder fade: under an SC its table stays out on laps 1–3 and boxes onto hards on laps 4–10. */
const tableB = (): ReactionTable =>
  reactionTable(solveWorld(dpInput({ totalLaps: LAPS, car: { compound: 'medium', degMsPerLap: { soft: 40, medium: 40, hard: 20 } }, sets: { hard: 1, medium: 1 }, ...DP_HAZARD }), 0));

/** Our car alone ahead, a rival far behind with no stop ahead; quiet. */
const START = (): StartingPoint => startingPoint({ lapsTotal: LAPS, cars: [{ gapMs: 0 }, { gapMs: 60_000 }], ours: [0] });

/** The laps on our car's set at `lap`'s start under `plan` (its stops before `lap`). */
function tyreAgeAt(start: StartingPoint, plan: Policy, lap: number): number {
  const last = plan.stops.filter((s) => s.lap < lap).at(-1);
  return last === undefined ? (start.tyreAge[0] ?? 0) + (lap - start.lap) : lap - last.lap - 1;
}

/** The table's move for our car on `plan` when a neutralisation starts on `lap`. */
const moveAt = (t: ReactionTable, start: StartingPoint, plan: Policy, lap: number, condition: 'sc' | 'vsc') =>
  reactAt(t, { lap, node: nodeAlong(t, plan, lap), tyreAge: tyreAgeAt(start, plan, lap), condition });

/** The stops our car plays when a neutralisation starts on `lap`: the plan, or its earlier stops, the box and `continueFrom`. */
function reacted(t: ReactionTable, start: StartingPoint, plan: Policy, lap: number, condition: 'sc' | 'vsc'): Policy {
  const move = moveAt(t, start, plan, lap, condition);
  if (move === 'stay') return plan;
  const boxed: Policy = { stops: [...plan.stops.filter((s) => s.lap < lap), { lap, compound: move.box }] };
  const rest = continueFrom(t, { lap: lap + 1, node: nodeAlong(t, boxed, lap + 1), tyreAge: 0 });
  return { stops: [...boxed.stops, ...rest.stops] };
}

/** An SC from lap `from` for `laps` laps in every scenario (`hazard`'s lap index 0 = the start lap 1). */
const scFor = (from: number, laps: number) => hazard(LAPS, { sc: { [from - 1]: 1 }, scDur: [...Array.from({ length: laps - 1 }, () => 0), 1] });

/** Our car's mean race time over 20 scenarios following `plan` with `table`. */
function meanOf(start: StartingPoint, plan: Policy, hz: ReturnType<typeof scFor>, table: ReactionTable | null): number {
  const input = mcInput(start, { 0: [plan] }, { hazard: hz, reactions: table === null ? {} : { 0: table } });
  return rowOf(carOf(scoreAll(input, createRng(23), 20), 0).rows, plan).meanMs;
}

/** The one forecast of our car following `policy` under an SC on laps `from … to`. */
const forecastMs = (start: StartingPoint, policy: Policy, from: number, to: number): number =>
  raceForecast(start, [policy, NO_STOP], drawn(1, [{ kind: 'sc', fromLap: from, toLap: to }]), createRng(1)).raceTimeMs[0]!;

describe('race-monte-carlo: our SC/VSC reaction (SP4.3d1 Task 4, spec §5.2)', () => {
  // row 1
  it('reaction plays: an SC on lap 12, the table says box H → the car boxes on lap 12 onto H and follows continueFrom', () => {
    const start = START();
    const t = tableA();
    const plan = stopAt(15, 'hard');
    expect(moveAt(t, start, plan, 12, 'sc'), 'the table boxes onto hards at that state').toEqual({ box: 'hard' });
    const played = reacted(t, start, plan, 12, 'sc');
    expect(played.stops[0]).toEqual({ lap: 12, compound: 'hard' });
    const mean = meanOf(start, plan, scFor(12, 2), t);
    expect(Math.abs(mean - forecastMs(start, played, 12, 13))).toBeLessThanOrEqual(1e-6);
    // the plan's own stop on lap 15 is not played
    expect(Math.abs(mean - forecastMs(start, plan, 12, 13))).toBeGreaterThan(1_000);
    // without a table the plan is played as listed (today's play)
    expect(Math.abs(meanOf(start, plan, scFor(12, 2), null) - forecastMs(start, plan, 12, 13))).toBeLessThanOrEqual(1e-6);
  });

  // row 2
  it('no hindsight: two scenarios equal except the SC\'s length (2 vs 6 laps) → the same reaction', () => {
    const start = START();
    const t = tableA();
    const plan = stopAt(15, 'hard');
    // the move is the table's at the SC's first lap: one answer whatever its length
    const played = reacted(t, start, plan, 12, 'sc');
    expect(played).not.toEqual(plan);
    const short = meanOf(start, plan, scFor(12, 2), t);
    const long = meanOf(start, plan, scFor(12, 6), t);
    expect(Math.abs(short - forecastMs(start, played, 12, 13))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(long - forecastMs(start, played, 12, 17))).toBeLessThanOrEqual(1e-6);
    expect(short).not.toBe(long);
  });

  // row 5
  it('one choice: a 4-lap SC yields at most one reaction box', () => {
    const start = START();
    const plan = stopAt(15, 'hard');
    // the table stays out on the SC's first lap (3) and would box on its next (4): no box on laps 4–6, the plan goes on
    const b = tableB();
    expect(moveAt(b, start, plan, 3, 'sc')).toBe('stay');
    expect(moveAt(b, start, plan, 4, 'sc'), 'a later lap of the SC would box').toEqual({ box: 'hard' });
    expect(Math.abs(meanOf(start, plan, scFor(3, 4), b) - forecastMs(start, plan, 3, 6))).toBeLessThanOrEqual(1e-6);
    // the table boxes on the SC's first lap (12): that one stop and the continuation, nothing more on laps 13–15
    const a = tableA();
    const played = reacted(a, start, plan, 12, 'sc');
    expect(played.stops.filter((s) => s.lap >= 12 && s.lap <= 15), 'the continuation makes no stop under the SC').toEqual([{ lap: 12, compound: 'hard' }]);
    expect(Math.abs(meanOf(start, plan, scFor(12, 4), a) - forecastMs(start, played, 12, 15))).toBeLessThanOrEqual(1e-6);
  });

  // row 6 (ported: Task 19's row 13 with reaction tables)
  it('determinism: same seed, same input → bit-identical MC output', () => {
    const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
    const start = startingPoint({ lapsTotal: 6, cars, ours: [2, 3] });
    // an SC on lap 2 (where the tables box onto hards) or a VSC on lap 4 (where they stay out) in some scenarios
    const hz = hazard(6, { sc: { 1: 0.2 }, vsc: { 3: 0.1 } });
    const table = (): ReactionTable =>
      reactionTable(solveWorld(dpInput({ totalLaps: 6, car: { compound: 'medium', degMsPerLap: { soft: 400, medium: 400, hard: 50 } }, sets: { hard: 1, medium: 1 }, scByLap: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2], vscByLap: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] }), 0));
    const candidates = { 2: [NO_STOP, stopAt(2), stopAt(3, 'medium')], 3: [NO_STOP, stopAt(4)] };
    const input = (reactions: Record<number, ReactionTable>) => mcInput(start, candidates, { hazard: hz, reactions });
    const once = raceMonteCarlo(input({ 2: table(), 3: table() }), createRng(31), 2_000);
    expect(raceMonteCarlo(input({ 2: structuredClone(table()), 3: table() }), createRng(31), 2_000)).toStrictEqual(once);
    // the tables are in play: without them the same run reads otherwise
    expect(raceMonteCarlo(input({}), createRng(31), 2_000)).not.toStrictEqual(once);
  });
});
