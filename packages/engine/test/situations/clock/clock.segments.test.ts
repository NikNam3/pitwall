// Step 0, the clock, on committed segments (contract C7, C36; facts in fixtures/index.json): every fall that is no
// flashback is carried over, never re-timed, and the race clock never falls: the settling after lights out and the
// formation reset before it (race-zandvoort-online-start), a fall inside the formation (race-zandvoort-clock-reset); a
// flashback appends no clock fact (race-singapore-wet-flashback). One replay per segment, from its first frame that carries a Session packet.
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type DeepReadonly, type EngineState, type Frame, type StepResult } from '../../../src/index.ts';
import { segmentPackets } from '../../../../../test-support/segments.ts';

type History = DeepReadonly<EngineState['history']>;
/** One applied frame: the game's session time, the race clock after it, and what the step did. */
type Step = {
  raw: number;
  race: number;
  lightsOut: boolean;
  rewound: boolean;
  flashback: boolean;
  /** The length of the log's clock list after the step. */
  logClock: number;
  /** The history before the step, kept only for a step on which the session time fell. */
  before?: History;
};
type Replay = { runner: SessionRunner; steps: Step[] };

/** Runs the segment's session through a `SessionRunner`, noting every step. */
async function replay(file: string): Promise<Replay> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined)!;
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
  const steps: Step[] = [];
  let history: History = structuredClone(runner.state.history);
  const onResult = (r: StepResult, f: Frame) => {
    const previous = steps.at(-1);
    steps.push({
      raw: f.sessionTime,
      race: r.state.sessionTime,
      lightsOut: f.events.some((e) => e.details.code === 'LGOT'),
      rewound: r.delta.rewound !== undefined,
      flashback: r.flashback !== undefined,
      logClock: r.state.log.clock.length,
      ...(previous !== undefined && f.sessionTime < previous.raw && { before: history }),
    });
    history = structuredClone(r.state.history);
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  return { runner, steps };
}

/** The facts recorded before a step, as readers saw them then, and the same positions now. */
const prefixes = (before: History, now: History) => ({
  before: { events: before.events, crossings: before.crossings, laps: before.laps },
  now: { events: now.events.slice(0, before.events.length), crossings: now.crossings.slice(0, before.crossings.length), laps: now.laps.slice(0, before.laps.length) },
});
/** The race-clock times that fall below the one before them. */
const fallsIn = (times: readonly number[]) => times.filter((t, i) => i > 0 && t < times[i - 1]!);

describe('race-zandvoort-online-start: the race clock settles after lights out (start shape S3)', () => {
  let run: Replay;
  /** The race's lights out and the first fall of the session time after it. */
  let lgot: number;
  let fall: number;
  beforeAll(async () => {
    run = await replay('race-zandvoort-online-start.pwrec.gz');
    lgot = run.steps.map((s) => s.lightsOut).lastIndexOf(true);
    fall = run.steps.findIndex((s, i) => i > lgot && s.raw < run.steps[i - 1]!.raw);
  });

  it('the fall within 60 frames after lights out is carried over: one fall fact with the game’s times of the frames around it', () => {
    const { runner, steps } = run;
    expect([lgot >= 0, fall > lgot, fall - lgot <= 60]).toEqual([true, true, true]);
    const [from, to] = [steps[fall - 1]!.raw, steps[fall]!.raw];
    expect(runner.state.log.clock.slice(steps[fall - 1]!.logClock, steps[fall]!.logClock)).toMatchObject([
      { kind: 'fall', at: steps[fall - 1]!.race, fromMs: from, toMs: to, offsetMs: from - to },
    ]);
    expect([steps[fall]!.rewound, steps[fall]!.flashback]).toEqual([false, false]);
  });
  it('nothing recorded is re-timed: the facts recorded before the fall keep their times, lights out the time of its frame', () => {
    const { runner, steps } = run;
    const { before, now } = prefixes(steps[fall]!.before!, runner.state.history);
    expect(now).toEqual(before);
    expect(runner.state.history.events.filter((e) => e.kind === 'lightsOut').map((e) => e.at)).toEqual([steps[lgot]!.race]);
  });
  it('the frames after the fall lie on the race clock: their session time plus the offset, and the race clock never falls', () => {
    const { steps } = run;
    const offset = steps[fall]!.race - steps[fall]!.raw;
    expect(offset).toBe(steps[fall - 1]!.raw - steps[fall]!.raw + (steps[fall - 1]!.race - steps[fall - 1]!.raw));
    expect(steps.slice(fall).filter((s) => s.race !== s.raw + offset)).toEqual([]);
    expect(fallsIn(steps.map((s) => s.race))).toEqual([]);
  });
  it('the formation reset before lights out is carried over too: every fall of the session time is a fall fact on its step', () => {
    const { runner, steps } = run;
    const falls = steps.flatMap((s, i) => (s.before !== undefined ? [i] : []));
    expect(falls.length).toBeGreaterThan(1);
    expect(falls.filter((i) => i < lgot)).not.toEqual([]);
    expect(runner.state.log.clock.filter((f) => f.kind === 'fall')).toMatchObject(
      falls.map((i) => ({ kind: 'fall', at: steps[i - 1]!.race, fromMs: steps[i - 1]!.raw, toMs: steps[i]!.raw, offsetMs: steps[i - 1]!.raw - steps[i]!.raw })),
    );
  });
});

describe('race-zandvoort-clock-reset: a fall of the session time inside the formation, no FLBK, no lights out (C36: carried over)', () => {
  let run: Replay;
  /** The first step whose session time fell by more than 1 s. */
  let fall: number;
  beforeAll(async () => {
    run = await replay('race-zandvoort-clock-reset.pwrec.gz');
    fall = run.steps.findIndex((s, i) => i > 0 && s.raw < run.steps[i - 1]!.raw - 1000);
  });

  it('is no flashback and rewinds nothing', () => {
    expect([fall > 0, run.steps[fall]!.flashback, run.steps.filter((s) => s.rewound)]).toEqual([true, false, []]);
  });
  it('re-times nothing: the facts recorded before it keep their times', () => {
    const { before, now } = prefixes(run.steps[fall]!.before!, run.runner.state.history);
    expect(now).toEqual(before);
    expect(before.crossings.length).toBeGreaterThan(0);
  });
  it('is carried over: one fall fact with the game’s times of the frames around it, and the race clock never falls', () => {
    const { runner, steps } = run;
    const [from, to] = [steps[fall - 1]!.raw, steps[fall]!.raw];
    expect(runner.state.log.clock).toMatchObject([{ kind: 'fall', at: steps[fall - 1]!.race, fromMs: from, toMs: to, offsetMs: from - to }]);
    expect(fallsIn(steps.map((s) => s.race))).toEqual([]);
  });
});

describe('race-singapore-wet-flashback: flashbacks on lap 7', () => {
  let run: Replay;
  beforeAll(async () => {
    run = await replay('race-singapore-wet-flashback.pwrec.gz');
  });

  it('a flashback appends no clock fact: the session time falls only through the flashbacks the runner takes', () => {
    const { runner, steps } = run;
    expect(steps.filter((s) => s.flashback).length).toBeGreaterThan(0);
    expect(steps.some((s) => s.before !== undefined)).toBe(true);
    expect(runner.state.log.clock).toEqual([]);
  });
});
