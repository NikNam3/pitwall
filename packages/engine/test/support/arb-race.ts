// A deterministic race on a 1000 m track, 16 ms frames, built through the encoder.
import fc from 'fast-check';
import type { EventDetails } from '@pitwall/protocol';
import type { Frame } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';

const TRACK = 1000;
const STEP = 16;

export type RaceParams = {
  cars: number;
  frames: number;
  speeds: number[];
  jitter: number[];
  truncation: number[];
  flashback: { at: number; back: number; viaEvent: boolean } | undefined;
};

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
});

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

function build(p: RaceParams, ticks: Tick[], event?: { before: number; details: EventDetails }): Frame[] {
  const apply = (d: FrameDraft) => {
    const tick = ticks[d.index]!;
    tick.rows.forEach((row, k) => Object.assign(d.lapData.lapData[k]!, row));
    tick.history?.forEach((laps, k) =>
      d.add('sessionHistory', { carIdx: k, numLaps: laps.length + 1, lapHistoryData: [...laps, { lapValidBitFlags: 0b1111 }] }),
    );
  };
  const b = new ScenarioBuilder({ cars: p.cars, stepMs: STEP }).session({ trackLength: TRACK });
  if (!event) return b.frames(ticks.length, apply).build();
  return b
    .frames(event.before, apply)
    .event(event.details)
    .frames(ticks.length - event.before, apply)
    .build();
}

const fresh = (n: number): Car[] => Array.from({ length: n }, () => ({ total: 0, lapStart: 0, lastLap: 0, s1: 0, s2: 0, done: [] }));

export function raceFrames(p: RaceParams): { frames: Frame[]; reference: Frame[] } {
  const fb = p.flashback && p.flashback.at < p.frames && p.flashback.at - p.flashback.back >= 1 ? p.flashback : undefined;
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
  const details: EventDetails = { code: 'FLBK', flashbackFrameIdentifier: target, flashbackSessionTime: (target * STEP) / 1000 };
  // salt 3: the timeline diverges
  const replayed = build(
    p,
    [...prefix, ...simulate(p, fork, target + 1, target + 1 + p.frames - fb.at, 3)],
    fb.viaEvent ? { before: target + 1, details } : undefined,
  );
  const continuation = replayed.slice(target + 1).map((f, k) => ({ ...f, overallFrameId: fb.at + k }));
  return {
    frames: [...original, ...continuation],
    reference: replayed.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') })),
  };
}
