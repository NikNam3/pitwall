// A deterministic race on a 1000 m track, 16 ms frames, built through the encoder, with optional session-phase beats
// (review 2 B5): the start (five start lights and lights out, perhaps after a formation lap whose clock resets at its
// end), a neutralisation (SCAR and safety car status, or either alone), a red flag and a mid-race fall of the session time.
import fc from 'fast-check';
import { feedId } from '@pitwall/domain';
import type { EventDetails, Packet } from '@pitwall/protocol';
import { SessionTracker, type Frame } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';

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

export type RaceParams = {
  cars: number;
  frames: number;
  speeds: number[];
  jitter: number[];
  truncation: number[];
  flashback: { at: number; back: number; viaEvent: boolean } | undefined;
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

export const arbRace: fc.Arbitrary<RaceParams> = fc.record({
  cars: fc.integer({ min: 1, max: 6 }),
  frames: fc.integer({ min: 60, max: 300 }),
  speeds: fc.array(fc.integer({ min: 15, max: 45 }), { minLength: 6, maxLength: 6 }),
  jitter: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 20 }),
  // the game truncates sectors: lap − Σ ∈ 0..2
  truncation: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 5 }),
  flashback: fc.option(fc.record({ at: fc.integer({ min: 20, max: 299 }), back: fc.integer({ min: 3, max: 60 }), viaEvent: fc.boolean() }), {
    nil: undefined,
  }),
  phases: arbPhases,
});

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

/** The frames of `ticks` with the phase beats, plus `extra` events by frame index; the packets carry the beats' session times. */
function build(p: RaceParams, ticks: Tick[], extra: ReadonlyMap<number, EventDetails> = new Map()): Frame[] {
  const b = new ScenarioBuilder({ cars: p.cars, stepMs: STEP }).session({ trackLength: TRACK });
  ticks.forEach((tick, i) => {
    const { events, status } = signalsOf(p.phases, i);
    const own = extra.get(i);
    for (const details of own ? [...events, own] : events) b.event(details);
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

/**
 * The race's frames, and the frames of a run that never had the ones a flashback discards. A flashback goes back no
 * further than a formation lap's lights out: the game cannot rewind past the race start.
 */
export function raceFrames(p: RaceParams): { frames: Frame[]; reference: Frame[] } {
  const earliest = p.phases.start === 'formation' ? lightsOutAt('formation')! : 1;
  const fb = p.flashback && p.flashback.at < p.frames && p.flashback.at - p.flashback.back >= earliest ? p.flashback : undefined;
  if (!fb) {
    const frames = build(p, simulate(p, fresh(p.cars), 0, p.frames, 0));
    return { frames, reference: frames };
  }
  const target = fb.at - fb.back;
  const cars = fresh(p.cars);
  const prefix = simulate(p, cars, 0, target + 1, 0);
  const fork = structuredClone(cars);
  // frames 0..at-1
  const original = build(p, [...prefix, ...simulate(p, cars, target + 1, fb.at, 0)]);
  const details: EventDetails = { code: 'FLBK', flashbackFrameIdentifier: target, flashbackSessionTime: timeOf(p.phases, target) / 1000 };
  // salt 3: the timeline diverges
  const replayed = build(
    p,
    [...prefix, ...simulate(p, fork, target + 1, target + 1 + p.frames - fb.at, 3)],
    fb.viaEvent ? new Map([[target + 1, details]]) : undefined,
  );
  // overallFrameIdentifier goes on rising across the rewind; the receive times stay the reference's, so the state's
  // last receive time compares equal
  const continuation = replayed.slice(target + 1).map((f, k) => ({ ...f, overallFrameId: fb.at + k }));
  return {
    frames: [...original, ...continuation],
    reference: replayed.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') })),
  };
}
