// The race start on the four start shapes of t1-diagnosis.md (facts in fixtures/index.json): S1 no formation lap
// (race-singapore-start), S2 a formation lap with one reset to 0 (race-singapore-wet-start), S3 a reset to 1.968 s and
// the race clock settling after lights out (race-zandvoort-online-start), S4 resets, a small fall and the settling
// after lights out (race-zandvoort-uid-reuse-start). The engine and `gaps` only; one replay per segment.
import { beforeAll, describe, expect, it } from 'vitest';
import { GAPS, gapsCalculator, type GapsOutput } from '@pitwall/analysis';
import type { RaceEvent } from '@pitwall/domain';
import type { EngineState, DeepReadonly } from '@pitwall/engine';
import { situationOf } from '../../../../packages/engine/src/situations/run.ts';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const SHAPES = [
  ['S1', 'race-singapore-start.pwrec.gz'],
  ['S2', 'race-singapore-wet-start.pwrec.gz'],
  ['S3', 'race-zandvoort-online-start.pwrec.gz'],
  ['S4', 'race-zandvoort-uid-reuse-start.pwrec.gz'],
] as const;

/** The game's event codes that become race events, and their kinds; the situation events (PENA, RTMT, DRSE, DRSD, STLG, LGOT) are spans (C13, Task 21). */
const KIND_OF: Readonly<Record<string, RaceEvent['kind']>> = {
  OVTK: 'overtake', COLL: 'collision', FTLP: 'fastestLap', SPTP: 'speedTrap',
};

type Replayed = {
  state: DeepReadonly<EngineState>;
  gaps: GapsOutput;
  /** The race events the frames from the lights-out frame on carry, the lights out itself excluded. */
  raceKinds: string[];
  /** The lowest race-clock time (C35) of the frames from lights out on. */
  lowestAfterLightsOut: number;
};

const replayed = new Map<string, Replayed>();
const S4 = 'race-zandvoort-uid-reuse-start.pwrec.gz';

/** The lap recorder's open laps by car (its own state, `open.recorders.laps`, C10): the lap a car is on and how it began. */
type LapCursorView = { lap: number; fromStart: boolean; startedAt: number };
const lapCursors = (state: DeepReadonly<EngineState>): ReadonlyArray<LapCursorView | undefined> =>
  (state.open.recorders['laps'] as unknown as { cursors: ReadonlyArray<LapCursorView | undefined> }).cursors;

beforeAll(async () => {
  for (const [, file] of SHAPES) {
    let gaps: GapsOutput | undefined;
    let out = false;
    const raceKinds: string[] = [];
    let lowest = Infinity;
    const runner = await replayScheduled(segmentPath(file), [gapsCalculator], (r, scheduled, f) => {
      const codes = f.events.map((e) => e.details.code);
      if (!out && codes.includes('LGOT')) out = true;
      else if (out) raceKinds.push(...codes.flatMap((c) => (KIND_OF[c] ? [KIND_OF[c]] : [])));
      if (out) lowest = Math.min(lowest, r.state.sessionTime);
      gaps = scheduled.outputs.get(GAPS) as GapsOutput;
    });
    replayed.set(file, { state: runner.state, gaps: structuredClone(gaps!), raceKinds, lowestAfterLightsOut: lowest });
  }
});

/** The race start: the opening of the first racing span of `session-phase-race`, closed or still open (C20). */
const raceStart = (state: DeepReadonly<EngineState>): number | undefined =>
  [...(state.history.spans['session-phase-race'] ?? []), ...(situationOf(state).byMachine['session-phase-race'] ?? [])].find((s) => s.kind === 'racing')?.start;

describe.each(SHAPES)('the race start, shape %s (%s)', (_, file) => {
  it('the race start is lights out on the race clock: one lights out, the racing phase opens at it, no later than any frame after it', () => {
    const { state, lowestAfterLightsOut } = replayed.get(file)!;
    // lights out: where the race's startLights span closed (C20; a span since Task 21, no race event)
    const lightsOut = (state.history.spans['session-phase-race'] ?? []).filter((s) => s.kind === 'startLights').map((s) => s.end);
    const start = raceStart(state);
    expect(lightsOut).toEqual([start]);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThanOrEqual(lowestAfterLightsOut);
  });
  // S4 (race-zandvoort-uid-reuse-start) has its own row below: its weekend phase is decided inside the formation lap.
  it.runIf(file !== S4)('nothing recorded before lights out is shown: the formation lap is hidden (C29); the start lights are spans, no race events', () => {
    const { state, raceKinds } = replayed.get(file)!;
    expect(state.history.events.map((e) => e.kind)).toEqual(raceKinds);
  });
  it('every running car is on lap 1, seen from its start at lights out', () => {
    const { state } = replayed.get(file)!;
    const start = raceStart(state);
    const off = state.cars.filter((c) => c.active).flatMap((c) => {
      const cursor = lapCursors(state)[c.id];
      return cursor && cursor.lap === 1 && cursor.fromStart && cursor.startedAt === start ? [] : [`car ${c.id}: ${JSON.stringify(cursor && { lap: cursor.lap, fromStart: cursor.fromStart, startedAt: cursor.startedAt })}`];
    });
    expect(off).toEqual([]);
  });
  it('the gapper has the race start', () => {
    const { state, gaps } = replayed.get(file)!;
    expect(gaps.raceStartAt).toMatchObject({ known: true, value: raceStart(state) });
  });
});

// C14: pending = on the grid; ruled 2026-11-03. In race-zandvoort-uid-reuse-start the first Session packet has no
// weekend structure, which arrives only in the formation lap. While the weekend phase is pending no per-phase sub-machine
// runs, so no formation span covers those frames: their facts stay visible (C29 hides only what a formation span
// covers). From the frame the weekend phase is decided, the formation span opens and hides what follows until the start
// lights.
describe('the race start, shape S4: the weekend phase decided inside the formation lap (C14, C29)', () => {
  it('facts recorded before the weekend phase is decided are visible; facts from the frame the formation span opens are hidden', () => {
    const { state } = replayed.get(S4)!;
    const decided = situationOf(state).byMachine['weekend-phase']?.[0]?.startFrame;
    const formation = (state.history.spans['session-phase-race'] ?? []).find((s) => s.kind === 'formation');
    expect(formation).toMatchObject({ startFrame: decided, joinedAt: true });
    // the race events, the mini-sector crossings and the clock facts (the start lights, lights out and the DRS notices are spans since Task 21)
    type Lists = { events: readonly { frame: number }[]; crossings: readonly { frame: number }[]; clock: readonly { frame: number }[] };
    const facts = (lists: Lists) => [...lists.events, ...lists.crossings, ...lists.clock];
    const before = facts(state.log).filter((e) => e.frame < decided!);
    const inFormation = facts(state.log).filter((e) => e.frame >= formation!.startFrame && e.frame < formation!.endFrame);
    expect(before.length).toBeGreaterThan(0);
    expect(inFormation.length).toBeGreaterThan(0);
    expect(facts(state.history).filter((e) => e.frame < decided!)).toEqual(before);
    expect(facts(state.history).filter((e) => e.frame >= formation!.startFrame && e.frame < formation!.endFrame)).toEqual([]);
  });
});
