// The race's session-phase sub-machine on committed segments (contract C14, C18, C26, C29, C36, C84; facts in
// fixtures/index.json): the span sequence each start shape, the VSC and the session's end give. Every expected frame is
// read from the segment's own frames by the machine's rule (the first frame the weekend phase is decided, the frame of
// the first start light after it, of lights out, of the SCAR, of SEND), never a fact of the recording. One replay per
// segment, from its first frame that carries a Session packet; no segment holds a flashback, so no step rewinds.
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId, type OpenSpan, type Span } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type DeepReadonly, type Frame, type StepResult } from '../../../src/index.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { segmentPackets } from '../../../../../test-support/segments.ts';

const MACHINE = 'session-phase-race';

/** One applied frame: its number (C26), its event codes, the session flag and race-clock time after it, whether it rewound. */
type Step = { frameNumber: number; codes: string[]; flag: string; at: number; rewound: boolean };
type Replay = { runner: SessionRunner; steps: Step[]; weekendFrame: number | undefined };

/** Runs the segment's session through a `SessionRunner` (not finished: the open spans stay open), noting every step. */
async function replay(file: string): Promise<Replay> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined)!;
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
  const steps: Step[] = [];
  const onResult = (r: StepResult, f: Frame) =>
    steps.push({ frameNumber: r.state.frameNumber, codes: f.events.map((e) => e.details.code), flag: r.state.session.flag, at: r.state.sessionTime, rewound: r.delta.rewound !== undefined });
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  const weekendFrame = situationOf(runner.state).byMachine['weekend-phase']?.[0]?.startFrame;
  return { runner, steps, weekendFrame };
}

/** Every span of the machine, closed then open, as `[kind, startFrame, joined]`. */
const sequence = (runner: SessionRunner): Array<[string, number, boolean]> =>
  [...(runner.state.history.spans[MACHINE] ?? []), ...(situationOf(runner.state).byMachine[MACHINE] ?? [])].map((s: DeepReadonly<OpenSpan>) => [s.kind, s.startFrame, s.joinedAt === true]);
const openSpan = (runner: SessionRunner) => situationOf(runner.state).byMachine[MACHINE]?.[0];
/** The number of the first frame at or after `from` that carries `code`. */
const firstWith = (steps: readonly Step[], code: string, from = 0): number => steps.find((s) => s.frameNumber >= from && s.codes.includes(code))!.frameNumber;
/** The number of the last frame that carries `code`. */
const lastWith = (steps: readonly Step[], code: string): number => steps.findLast((s) => s.codes.includes(code))!.frameNumber;
const stepAt = (steps: readonly Step[], frameNumber: number): Step => steps.find((s) => s.frameNumber === frameNumber)!;

const STARTS = [
  ['S1, no formation lap', 'race-singapore-start.pwrec.gz'],
  ['S2, a formation lap with one reset to 0', 'race-singapore-wet-start.pwrec.gz'],
  ['S3, a reset to 1.968 s and the settling after lights out', 'race-zandvoort-online-start.pwrec.gz'],
  ['S4, resets, a small fall and the settling after lights out', 'race-zandvoort-uid-reuse-start.pwrec.gz'],
] as const;

describe.each(STARTS)('the race start, shape %s (%s)', (_, file) => {
  let run: Replay;
  beforeAll(async () => {
    run = await replay(file);
  });

  it('the first span opens on the first frame the weekend phase is decided: the formation lap (joined) when its status shows, else the grid (C14)', () => {
    const { runner, steps, weekendFrame } = run;
    expect(weekendFrame).toBeDefined();
    const formation = stepAt(steps, weekendFrame!).flag === 'formation';
    expect(sequence(runner)[0]).toEqual([formation ? 'formation' : 'grid', weekendFrame, formation]);
  });
  it('the start lights open on the first start light after it, racing on lights out, and racing stays open', () => {
    const { runner, steps, weekendFrame } = run;
    const lights = firstWith(steps, 'STLG', weekendFrame);
    expect(sequence(runner).slice(1)).toEqual([['startLights', lights, false], ['racing', lastWith(steps, 'LGOT'), false]]);
    expect(openSpan(runner)).toMatchObject({ kind: 'racing', start: stepAt(steps, lastWith(steps, 'LGOT')).at });
  });
  it('each span closes on the frame its successor opens on (C26), and no step rewinds (C29)', () => {
    const { runner, steps } = run;
    const spans = runner.state.history.spans[MACHINE] ?? [];
    const starts = sequence(runner).map(([, startFrame]) => startFrame);
    expect(spans.map((s) => s.endFrame)).toEqual(starts.slice(1));
    expect(steps.filter((s) => s.rewound)).toEqual([]);
  });
});

describe('race-zandvoort-vsc: a VSC deployment, then its status (§1.4, Review Focus 5)', () => {
  let run: Replay;
  beforeAll(async () => {
    run = await replay('race-zandvoort-vsc.pwrec.gz');
  });
  it('racing (joined on the first frame the weekend phase is decided), then the neutralisation from the SCAR frame', () => {
    const { runner, steps, weekendFrame } = run;
    expect(sequence(runner)).toEqual([['racing', weekendFrame, true], ['neutralised', firstWith(steps, 'SCAR'), false]]);
  });
  it('the neutralisation is the VSC, deployed at the SCAR’s time, and confirmed once the status shows it', () => {
    const { runner, steps } = run;
    const scar = stepAt(steps, firstWith(steps, 'SCAR'));
    expect(steps.some((s) => s.frameNumber > scar.frameNumber && s.flag === 'vsc')).toBe(true);
    expect(openSpan(runner)).toMatchObject({ kind: 'neutralised', start: scar.at, confirmed: true, detail: { car: 'VSC', stages: [{ stage: 'deployed', at: scar.at }] } });
  });
});

describe('race-singapore-end: a race left with SEND (§1.6, Review Focus 3)', () => {
  let run: Replay;
  beforeAll(async () => {
    run = await replay('race-singapore-end.pwrec.gz');
  });
  it('racing (joined), then the post-session from the SEND frame: no finish', () => {
    const { runner, steps, weekendFrame } = run;
    expect(sequence(runner)).toEqual([['racing', weekendFrame, true], ['postSession', firstWith(steps, 'SEND'), false]]);
  });
});

describe('race-singapore-wet-formation-end: a session that ends inside the formation lap (C18, C29)', () => {
  let run: Replay & { before: { spans: number; crossings: number; laps: number; events: number } };
  let formation: Span | undefined;
  beforeAll(async () => {
    const replayed = await replay('race-singapore-wet-formation-end.pwrec.gz');
    const { log } = replayed.runner.state;
    const before = { spans: log.spans[MACHINE]?.length ?? 0, crossings: log.crossings.length, laps: log.laps.length, events: log.events.length };
    replayed.runner.finish();
    run = { ...replayed, before };
    formation = replayed.runner.state.history.spans[MACHINE]?.at(-1);
  });

  it('the formation lap is joined on the first frame the weekend phase is decided and stays open to the last frame: no start light in the segment', () => {
    const { steps, weekendFrame, before } = run;
    expect(before.spans).toBe(0);
    expect(steps.some((s) => s.codes.includes('STLG'))).toBe(false);
    expect(formation).toMatchObject({ kind: 'formation', startFrame: weekendFrame, joinedAt: true });
  });
  it('a session that ends mid-formation closes the formation span at the last frame: at its time, covering it (endFrame the frame after it, C26)', () => {
    const last = run.steps.at(-1)!;
    expect(run.runner.state.history.spans[MACHINE]?.map((s) => s.kind)).toEqual(['formation']);
    expect(formation).toMatchObject({ end: last.at, endFrame: last.frameNumber + 1 });
  });
  it('its facts stay hidden in the log as stored: the log keeps them, the projection shows none (C24, C29)', () => {
    const { runner, before } = run;
    const { log, history } = runner.state;
    expect(before.crossings).toBeGreaterThan(0);
    expect([log.crossings.length, log.laps.length, log.events.length]).toEqual([before.crossings, before.laps, before.events]);
    const inFormation = (f: { frame: number }) => f.frame >= formation!.startFrame && f.frame < formation!.endFrame;
    expect(log.crossings.every(inFormation)).toBe(true);
    expect([history.crossings, history.laps, history.events, history.stints, history.pitStops]).toEqual([[], [], [], [], []]);
  });
});
