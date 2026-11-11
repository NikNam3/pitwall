// A deterministic race on a 1000 m track, 16 ms frames, built through the encoder, with optional session-phase beats
// (review 2 B5): the start (five start lights and lights out, perhaps after a formation lap whose clock resets at its
// end), a neutralisation (SCAR and safety car status, or either alone), a red flag and a mid-race fall of the session time.
// Up to two rewinds back to back, each perhaps with frames that still carry the pre-rewind session time (review 3 E1).
import fc from 'fast-check';
import { feedId } from '@pitwall/domain';
import type { EventDetails, Packet } from '@pitwall/protocol';
import { SessionTracker, type Frame } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { undoneTick } from './runner.ts';

const TRACK = 1000;
const STEP = 16;

/** The formation status at frame 1 and the clock's reset to 0 at frame 8; the five start lights from `LIGHTS_FROM`, lights out after them. */
const FORMATION_AT = 1;
const RESET_AT = 8;
const LIGHTS_FROM = { lights: 1, formation: RESET_AT + 1 } as const;
/** A mid-race fall of the session time comes no earlier: past every start's lights out and its settling window of 60 frames. */
const FALL_FROM = 80;

/** Session-phase signals by frame index; every timeline built from the same params carries them at the same frames. */
export type PhaseBeats = {
  /** No signal (the engine joins a race in progress), five start lights and lights out, or a formation lap before them. */
  start: 'none' | 'lights' | 'formation';
  /**
   * SC (1) or VSC (2) deployed at frame `at`: a SCAR and the safety car status `confirmAfter` frames later, a SCAR alone
   * (never confirmed: it is dropped after 3 s), or the status alone. `resumeAfter` frames after `at` the SCAR resume,
   * and the status back to green 5 frames after that.
   */
  neutralisation:
    | { car: 1 | 2; at: number; signal: 'scarAndStatus' | 'scarOnly' | 'statusOnly'; confirmAfter: number; resumeAfter: number | undefined }
    | undefined;
  /** An RDFL at this frame. */
  redFlag: number | undefined;
  /** The session time falls by `ms` at frame `FALL_FROM + after`, wherever the other beats are (frame ids keep rising, no FLBK). */
  fall: { after: number; ms: number } | undefined;
};

/** No phase beat: the engine joins a race in progress and nothing else happens. */
export const NO_PHASES: PhaseBeats = { start: 'none', neutralisation: undefined, redFlag: undefined, fall: undefined };

/**
 * One rewind of the game: `back` frames behind the frame before it, reported by an FLBK event or by the frame id going
 * back. Its first `stale` frames still carry the session time the game had before the rewind (inventory 1.10: the
 * target's frame ids with the old session time); they belong to the target's moment.
 */
export type Rewind = { back: number; viaEvent: boolean; stale: number };

export type RaceParams = {
  cars: number;
  frames: number;
  speeds: number[];
  jitter: number[];
  truncation: number[];
  /**
   * A rewind at frame `at` (the frames sent before it are 0..at-1), and perhaps a second one `after` frames past the
   * first one's stale frames, on its new timeline (inventory 1.10: rewinds 0.8 and 1.5 s apart).
   */
  flashback: (Rewind & { at: number; then: (Rewind & { after: number }) | undefined }) | undefined;
  phases: PhaseBeats;
};

const arbPhases: fc.Arbitrary<PhaseBeats> = fc.record({
  start: fc.constantFrom('none' as const, 'lights' as const, 'formation' as const),
  neutralisation: fc.option(
    fc.record({
      car: fc.constantFrom(1 as const, 2 as const),
      // early enough to reach its expiry in a race of 300 frames
      at: fc.integer({ min: 15, max: 100 }),
      // a SCAR alone twice as often: the drop at its 3 s expiry is the rarest path
      signal: fc.oneof(
        { arbitrary: fc.constant('scarOnly' as const), weight: 2 },
        { arbitrary: fc.constant('scarAndStatus' as const), weight: 1 },
        { arbitrary: fc.constant('statusOnly' as const), weight: 1 },
      ),
      // within the 3 s the tracker waits for the status (recorded lags 0.5–1.31 s, inventory 1.4)
      confirmAfter: fc.integer({ min: 5, max: 80 }),
      // before or after the 3 s a deployment waits for its status
      resumeAfter: fc.option(fc.integer({ min: 60, max: 280 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  redFlag: fc.option(fc.integer({ min: 15, max: 290 }), { nil: undefined, freq: 2 }),
  fall: fc.option(fc.record({ after: fc.integer({ min: 0, max: 219 }), ms: fc.integer({ min: 100, max: 1000 }) }), { nil: undefined }),
});

/** A rewind within a race of `frames` frames, perhaps followed by a second one. */
const arbFlashback = (frames: number): fc.Arbitrary<RaceParams['flashback']> =>
  fc.option(
    fc.record({
      at: fc.integer({ min: 20, max: frames - 1 }),
      back: fc.integer({ min: 3, max: 60 }),
      viaEvent: fc.boolean(),
      stale: fc.integer({ min: 0, max: 3 }),
      then: fc.option(
        // about 1 s apart at most; mostly close behind the first one, so the second rewind's replay often goes back
        // across the first one's stale frames (the snapshot it restores lies before them)
        fc.record({
          after: fc.oneof({ arbitrary: fc.integer({ min: 4, max: 14 }), weight: 3 }, { arbitrary: fc.integer({ min: 2, max: 70 }), weight: 1 }),
          back: fc.oneof({ arbitrary: fc.integer({ min: 3, max: 8 }), weight: 3 }, { arbitrary: fc.integer({ min: 3, max: 80 }), weight: 1 }),
          viaEvent: fc.boolean(),
          stale: fc.integer({ min: 0, max: 3 }),
        }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  );

/** The frames a rewind lands on (its target's next frame): the first one, and the second one's as `raceFrames` computes it. */
const landingFrames = (fb: NonNullable<RaceParams['flashback']>): number[] => {
  const first = fb.at - fb.back;
  return [first + 1, ...(fb.then ? [first + 1 + fb.stale + fb.then.after - fb.then.back + 1] : [])];
};

/**
 * No non-flashback fall of the session time lands on a rewind's landing frame (C27: the landing frame's session time
 * belongs to the flashback). The game lands imprecisely, below the target, so a fall on that very frame cannot be told
 * from the landing and is no observable case; a fall on the frame before or after it, or anywhere else, is generated.
 */
const fallAvoidsLanding = (p: RaceParams): boolean => {
  const fall = fallAt(p.phases);
  return fall === undefined || p.flashback === undefined || !landingFrames(p.flashback).includes(fall);
};

export const arbRace: fc.Arbitrary<RaceParams> = fc.integer({ min: 60, max: 300 }).chain((frames) =>
  fc.record({
    cars: fc.integer({ min: 1, max: 6 }),
    frames: fc.constant(frames),
    speeds: fc.array(fc.integer({ min: 15, max: 45 }), { minLength: 6, maxLength: 6 }),
    jitter: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 20 }),
    // the game truncates sectors: lap − Σ ∈ 0..2
    truncation: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 5 }),
    flashback: arbFlashback(frames),
    phases: arbPhases,
  }).filter(fallAvoidsLanding),
);

/** The frame of lights out, if the race starts with lights. */
const lightsOutAt = (start: PhaseBeats['start']): number | undefined => (start === 'none' ? undefined : LIGHTS_FROM[start] + 5);

/** The frame the session time falls at, if it does. */
const fallAt = (b: PhaseBeats): number | undefined => (b.fall ? FALL_FROM + b.fall.after : undefined);

/** Session time of frame i: 16 ms a frame, from 0 again at a formation lap's reset, and lower by the fall from its frame on. */
const timeOf = (b: PhaseBeats, i: number): number => {
  const fall = fallAt(b);
  const base = b.start === 'formation' && i >= RESET_AT ? (i - RESET_AT) * STEP : i * STEP;
  return base - (b.fall && fall !== undefined && i >= fall ? b.fall.ms : 0);
};

/** The beats' events in frame i and, when it changes there, the safety car status. */
function signalsOf(b: PhaseBeats, i: number): { events: EventDetails[]; status: number | undefined } {
  const events: EventDetails[] = [];
  let status: number | undefined;
  if (b.start === 'formation' && i === FORMATION_AT) status = 3;
  if (b.start === 'formation' && i === RESET_AT) status = 0;
  const lightsOut = lightsOutAt(b.start);
  if (lightsOut !== undefined && i >= lightsOut - 5 && i < lightsOut) events.push({ code: 'STLG', numLights: i - lightsOut + 6 });
  if (i === lightsOut) events.push({ code: 'LGOT' });
  const n = b.neutralisation;
  if (n) {
    const scar = n.signal !== 'statusOnly';
    const withStatus = n.signal !== 'scarOnly';
    if (scar && i === n.at) events.push({ code: 'SCAR', safetyCarType: n.car, eventType: 0 });
    if (withStatus && i === (scar ? n.at + n.confirmAfter : n.at)) status = n.car;
    if (n.resumeAfter !== undefined && scar && i === n.at + n.resumeAfter) events.push({ code: 'SCAR', safetyCarType: n.car, eventType: 3 });
    if (n.resumeAfter !== undefined && withStatus && i === n.at + n.resumeAfter + 5) status = 0;
  }
  if (i === b.redFlag) events.push({ code: 'RDFL' });
  return { events, status };
}

type Lap = { lapTimeInMs: number; sector1TimeMs: number; sector2TimeMs: number; sector3TimeMs: number; lapValidBitFlags: number };
type Car = { total: number; lapStart: number; lastLap: number; s1: number; s2: number; done: Lap[] };
type Tick = { rows: Array<Record<string, number>>; history: Lap[][] | undefined };

function simulate(p: RaceParams, cars: Car[], from: number, to: number, salt: number): Tick[] {
  const ticks: Tick[] = [];
  for (let i = from; i < to; i++) {
    const t = i * STEP;
    cars.forEach((c, k) => {
      const before = Math.floor(c.total / TRACK);
      c.total += p.speeds[k]! + p.jitter[(i * 7 + k + salt) % p.jitter.length]!;
      if (Math.floor(c.total / TRACK) > before) {
        c.lastLap = t - c.lapStart;
        c.done.push({
          lapTimeInMs: c.lastLap,
          sector1TimeMs: c.s1,
          sector2TimeMs: c.s2,
          sector3TimeMs: c.lastLap - c.s1 - c.s2 - p.truncation[k % p.truncation.length]!,
          lapValidBitFlags: 0b1111,
        });
        Object.assign(c, { lapStart: t, s1: 0, s2: 0 });
      }
      const d = c.total % TRACK;
      if (c.s1 === 0 && d >= TRACK / 3) c.s1 = t - c.lapStart;
      if (c.s2 === 0 && d >= (2 * TRACK) / 3) c.s2 = t - c.lapStart - c.s1;
    });
    const order = cars.map((_, k) => k).sort((a, b) => cars[b]!.total - cars[a]!.total || a - b);
    ticks.push({
      rows: cars.map((c, k) => ({
        currentLapNum: Math.floor(c.total / TRACK) + 1,
        lapDistance: c.total % TRACK,
        totalDistance: c.total,
        lastLapTimeInMs: c.lastLap,
        sector1TimeMs: c.s1,
        sector2TimeMs: c.s2,
        carPosition: order.indexOf(k) + 1,
      })),
      history: i % 30 === 29 ? cars.map((c) => [...c.done]) : undefined,
    });
  }
  return ticks;
}

/** The frames of `ticks` with the phase beats; the packets carry the beats' session times. */
function build(p: RaceParams, ticks: Tick[]): Frame[] {
  const b = new ScenarioBuilder({ cars: p.cars, stepMs: STEP }).session({ trackLength: TRACK });
  ticks.forEach((tick, i) => {
    const { events, status } = signalsOf(p.phases, i);
    for (const details of events) b.event(details);
    if (status !== undefined) b.session({ trackLength: TRACK, safetyCarStatus: status });
    b.frame((d: FrameDraft) => {
      tick.rows.forEach((row, k) => Object.assign(d.lapData.lapData[k]!, row));
      tick.history?.forEach((laps, k) =>
        d.add('sessionHistory', { carIdx: k, numLaps: laps.length + 1, lapHistoryData: [...laps, { lapValidBitFlags: 0b1111 }] }),
      );
    });
  });
  const tracker = new SessionTracker({ feedId: feedId('scenario') });
  const events = b.packets().flatMap(({ packet, receivedAtMs }) => {
    const sessionTime = timeOf(p.phases, packet.header.frameIdentifier) / 1000;
    return tracker.push({ ...packet, header: { ...packet.header, sessionTime } } as Packet, receivedAtMs);
  });
  return [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
}

const fresh = (n: number): Car[] => Array.from({ length: n }, () => ({ total: 0, lapStart: 0, lastLap: 0, s1: 0, s2: 0, done: [] }));

/** A timeline: from each fork's frame on, the cars drive with its salt (salt 0 from frame 0). */
type Fork = { from: number; salt: number };

/** The ticks of frames 0..to-1 of the timeline `forks`. */
function ticksOf(p: RaceParams, forks: readonly Fork[], to: number): Tick[] {
  const cars = fresh(p.cars);
  return forks.flatMap((fork, i) => simulate(p, cars, fork.from, Math.min(forks[i + 1]?.from ?? to, to), fork.salt));
}

/** A rewind taken: its target frame, its stale frames and the timeline it starts. */
type Taken = { target: number; stale: number; viaEvent: boolean; forks: Fork[] };

/** `frames` with frames `from`.. (`count` of them) carrying the session time `ms`; the packets keep the game's. */
const carrying = (frames: Frame[], from: number, count: number, ms: number): Frame[] =>
  frames.map((f, i) => (i >= from && i < from + count ? { ...f, sessionTime: ms } : f));

/**
 * The race's frames, and the frames of a run that never had the ones a rewind discards. A rewind goes back no further
 * than a formation lap's lights out: the game cannot rewind past the race start. In the reference, a rewind's stale
 * frames carry the session time of its target frame, the moment they belong to.
 */
export function raceFrames(p: RaceParams): { frames: Frame[]; reference: Frame[] } {
  const earliest = p.phases.start === 'formation' ? lightsOutAt('formation')! : 1;
  const fb = p.flashback && p.flashback.at < p.frames && p.flashback.at - p.flashback.back >= earliest ? p.flashback : undefined;
  if (!fb) {
    const frames = build(p, ticksOf(p, [{ from: 0, salt: 0 }], p.frames));
    return { frames, reference: frames };
  }
  // salt 3, then salt 5: each rewind's timeline diverges
  const first: Taken = { target: fb.at - fb.back, stale: fb.stale, viaEvent: fb.viaEvent, forks: [{ from: 0, salt: 0 }, { from: fb.at - fb.back + 1, salt: 3 }] };
  const rewinds = [first];
  /** Frames sent on each timeline: the original up to `at`, then each rewind's continuation; `p.frames` in all. */
  const sent = [fb.at];
  const then = fb.then;
  const at2 = then && first.target + 1 + fb.stale + then.after;
  if (then && at2 !== undefined && at2 - then.back >= earliest && fb.at + (at2 - first.target - 1) < p.frames) {
    const target = at2 - then.back;
    const forks = [...first.forks.filter((f) => f.from <= target), { from: target + 1, salt: 5 }];
    rewinds.push({ target, stale: then.stale, viaEvent: then.viaEvent, forks });
    sent.push(at2 - first.target - 1);
  }
  sent.push(p.frames - sent.reduce((a, b) => a + b, 0));

  /** Frames 0..length-1 of the timeline `forks`. */
  const timelineOf = (forks: readonly Fork[], length: number): Frame[] => build(p, ticksOf(p, forks, length));
  // frames 0..at-1 of the original
  let frames = timelineOf(first.forks.slice(0, 1), fb.at);
  let timeline = frames;
  /** Per rewind, how many of its first frames carry the session time of the frame before it. */
  const staleCounts: number[] = [];
  rewinds.forEach((r, k) => {
    timeline = timelineOf(r.forks, r.target + 1 + sent[k + 1]!);
    const own = timeline.slice(r.target + 1);
    // Reported by event: the old timeline's last tick carries the FLBK and is undone; the new timeline's first tick
    // shares its overall frame id (inventory 1.10). A run that never had the undone frames never has it.
    if (r.viaEvent) frames = [...frames, undoneTick(frames.at(-1)!, r.target, { targetMs: timeOf(p.phases, r.target) })];
    const nextOverall = frames.at(-1)!.overallFrameId + (r.viaEvent ? 0 : 1);
    // The first `stale` frames still carry the session time of the frame before the rewind. A frame right after them
    // that carries that time anyway (the new timeline reaching it again) is one of them: nothing tells it apart. A frame
    // on another time ends them, so the race does not end inside them (the engine would still wait for that frame).
    const oldMs = frames.at(-1)!.sessionTime;
    const staleFrom = (n: number): number => {
      let count = Math.min(n, own.length);
      while (count < own.length && own[count]!.sessionTime === oldMs) count++;
      return count;
    };
    const stale = staleFrom(r.stale) < own.length ? staleFrom(r.stale) : staleFrom(0);
    staleCounts.push(stale);
    // overallFrameIdentifier goes on rising across the rewind; the receive times stay the timeline's, so the state's
    // last receive time compares equal
    frames = [...frames, ...own.map((f, i) => ({ ...f, overallFrameId: nextOverall + i, ...(i < stale && { sessionTime: oldMs }) }))];
  });

  // the last timeline from its start; a stale frame a later rewind discarded is not in it
  let reference = timeline;
  rewinds.forEach((r, k) => {
    const kept = Math.min(staleCounts[k]!, (rewinds[k + 1]?.target ?? Infinity) - r.target);
    if (kept > 0) reference = carrying(reference, r.target + 1, kept, reference[r.target]!.sessionTime);
  });
  return { frames, reference };
}
