// `incidents` places its entries on the lap and on the track map (spec 6.2; contract C25, C31.2, C33, C43, C45): each
// entry's `where.fraction` (where its first car was on the lap at the incident's time, interpolated by time between the
// car's two mini-sector crossings around it) and `where.turn` (the turn whose apex is within `turnSnapM` of that
// fraction), and `markers`, the major entries of the last `markerLaps` leader laps at their point on the outline. The
// track file is `view.track` (here the committed Zandvoort file with the turns a test needs); the lap is the builder's
// 5 000 m track, a mini-sector 100 m. Every test runs the calculator through its guarded view (`race.ts`, C41).
import { describe, expect, it } from 'vitest';
import {
  carId,
  known,
  MINI_SECTORS,
  unknown,
  type IncidentEntry,
  type IncidentKind,
  type MapPoint,
  type RaceEvent,
  type TrackData,
  type TrackTurn,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { event, neutralisation } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import type { IncidentsOutput } from '../../src/incidents/index.ts';
import { pointAt } from '../../src/shared/track-lookup.ts';
import {
  deltaOf,
  incidents,
  leaderLaps,
  PLAYER,
  race,
  run,
  runOutput,
  stepsOutput,
  TRACK,
  until,
  viewOf,
  warned,
  type Delay,
  type RaceInput,
} from './race.ts';

/** Mid-lap 5 of the player (car 6): between its crossings (5, 24) at 407 400 and (5, 25) at 409 200. */
const T = 407_900;
/** Car 6's lap fraction at T: 500 of the 1 800 ms of mini-sector 24 done, so 24 + 5/18 mini-sectors into the lap. */
const F = (24 + 500 / 1_800) / MINI_SECTORS;
/** One metre of the builder's 5 000 m lap, as a lap fraction. */
const M = 1 / TRACK.trackLengthM;

/** A collision of cars `a` and `b` at `at`, describing the frame numbered by its time (as `race` numbers its crossings). */
const collision = (a: number, b: number, at = T): RaceEvent => event({ kind: 'collision', at, frame: at, carId: carId(a), otherCarId: carId(b) });

const turn = (label: string, apex: number): TrackTurn => ({ number: 1, label, apex });

/** The committed Zandvoort outline (500 points). */
const OUTLINE: MapPoint[] = (() => {
  const { outline } = zandvoortTrack();
  if (!outline.known) throw new Error('the Zandvoort fixture has no outline');
  return outline.value;
})();

/** `view.track`: the Zandvoort track file with `over` (turns, outline) in place of its own parts. */
const trackWith = (over: Partial<TrackData> = {}): EngineView['track'] => known({ ...zandvoortTrack(), ...over }, 0);

/** A track file whose only turn, `T7`, has its apex 50 m after car 6's place at T. */
const TRACK_T7 = trackWith({ turns: known([turn('T7', F + 50 * M)], 0) });

/** The entries of `kind` in the feed: exactly one. */
const only = (feed: IncidentEntry[], kind: IncidentKind): IncidentEntry => {
  const entries = feed.filter((e) => e.kind === kind);
  expect(entries, `entries of kind ${kind}`).toHaveLength(1);
  return entries[0]!;
};

/** The known fraction's value, close to `expected`; fails on an unknown one. */
const expectFraction = (entry: IncidentEntry, expected: number): void => {
  expect(entry.where.fraction).toMatchObject({ known: true, value: expect.closeTo(expected, 9) });
};

/** The markers, known; fails on unknown ones. */
const markerList = (out: IncidentsOutput) => {
  expect(out.markers.known, 'markers known').toBe(true);
  return out.markers.known ? out.markers.value : [];
};

/** A marker of `kind` at the outline point of `fraction`. */
const markerAt = (kind: IncidentKind, fraction: number) => {
  const { x, y } = pointAt(OUTLINE, fraction);
  return { kind, point: { x: expect.closeTo(x, 9), y: expect.closeTo(y, 9) } };
};

describe('incidents: where.fraction', () => {
  it('is where the first car was at the incident time, interpolated by time between its two crossings around it', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], track: TRACK_T7 })), 'collision');
    expectFraction(entry, F);
  });

  it('interpolates by the crossing times, not by an even mini-sector: a mini-sector twice as long puts the car half as far into it', () => {
    // car 6 loses 1.8 s in mini-sector 24 of lap 5 (under the 2 s time loss), so (5, 25) moves to 411 000
    const slow: Delay = { carId: PLAYER, lap: 5, segment: 24, ms: 1_800 };
    const entry = only(run(viewOf({ miniSectors: race({ delays: [slow] }), events: [collision(6, 5)] })), 'collision');
    expectFraction(entry, (24 + 500 / 3_600) / MINI_SECTORS);
  });

  it('needs only the track length: it is known without a track file', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)] })), 'collision');
    expectFraction(entry, F);
  });

  it('is insufficientData before the car has a crossing, and while its next crossing is not in the history yet', () => {
    const early = only(run(viewOf({ miniSectors: until(race(), 3_000), events: [collision(6, 5, 1_000)], track: TRACK_T7 })), 'collision');
    expect(early.where.fraction).toEqual(unknown('insufficientData'));
    // the history up to 408 000: car 6 crossed (5, 24) at 407 400, its (5, 25) is still to come
    const pending = only(run(viewOf({ miniSectors: until(race(), 408_000), events: [collision(6, 5)], track: TRACK_T7 })), 'collision');
    expect(pending.where.fraction).toEqual(unknown('insufficientData'));
  });

  it('is notApplicable for an entry without a car (a neutralisation), as its sector is, and so is its turn', () => {
    const sc = neutralisation({ kind: 'SC', start: T, end: T + 60_000 });
    const entry = only(run(viewOf({ miniSectors: race(), phases: [sc], track: TRACK_T7 })), 'neutralised');
    expect(entry.where).toEqual({ sector: unknown('notApplicable'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') });
  });
});

describe('incidents: where.turn', () => {
  it('is the label of the turn whose apex is within 60 m of the fraction, the nearest of them', () => {
    const track = trackWith({ turns: known([turn('T6', F - 100 * M), turn('T7', F + 50 * M), turn('T8', F + 58 * M)], 0) });
    const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], track })), 'collision');
    expect(entry.where.turn).toMatchObject({ known: true, value: 'T7' });
  });

  it('is insufficientData when no apex is within 60 m', () => {
    const track = trackWith({ turns: known([turn('T6', F - 100 * M), turn('T7', F + 70 * M)], 0) });
    const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], track })), 'collision');
    expect(entry.where.turn).toEqual(unknown('insufficientData'));
  });

  it('snaps within the configured turnSnapM: with 40 m the apex 50 m away is none', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], track: TRACK_T7, config: { turnSnapM: 40 } })), 'collision');
    expect(entry.where.turn).toEqual(unknown('insufficientData'));
  });

  it('is notApplicable without turns in the track file, and without a track file; the fraction is known in both', () => {
    const noTurns = trackWith({ turns: unknown('notReceived') });
    for (const track of [noTurns, unknown('notApplicable')] satisfies EngineView['track'][]) {
      const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], track })), 'collision');
      expect(entry.where.turn).toEqual(unknown('notApplicable'));
      expectFraction(entry, F);
    }
  });
});

describe('incidents: markers', () => {
  it('holds the major entries at the outline point of their fraction', () => {
    const out = runOutput(viewOf({ miniSectors: race(), events: [collision(6, 5)], track: TRACK_T7 }));
    expect(markerList(out)).toEqual([markerAt('collision', F)]);
  });

  it('holds no minor entry: a warning, or a collision with collisionMajor false', () => {
    const warning = runOutput(viewOf({ miniSectors: race(), spans: warned(7, [T]), track: TRACK_T7 }));
    expect(only(warning.feed, 'warning').severity).toBe('minor');
    expect(markerList(warning)).toEqual([]);
    const minor = runOutput(viewOf({ miniSectors: race(), events: [collision(6, 5)], track: TRACK_T7, config: { collisionMajor: false } }));
    expect(only(minor.feed, 'collision').severity).toBe('minor');
    expect(markerList(minor)).toEqual([]);
  });

  it('holds no entry without a known fraction: a major collision before its car has a crossing', () => {
    const out = runOutput(viewOf({ miniSectors: until(race(), 3_000), events: [collision(6, 5, 1_000)], track: TRACK_T7 }));
    expect(only(out.feed, 'collision').severity).toBe('major');
    expect(markerList(out)).toEqual([]);
  });

  it('keeps a marker whose entry fell off the feedLength cut', () => {
    // the newer warning of car 7 is the one entry the feed keeps; the collision before it stays a marker
    const out = runOutput(viewOf({ miniSectors: race(), events: [collision(6, 5)], spans: warned(7, [T + 10_000]), track: TRACK_T7, config: { feedLength: 1 } }));
    expect(out.feed.map((e) => e.kind)).toEqual(['warning']);
    expect(markerList(out)).toEqual([markerAt('collision', F)]);
  });

  it('is notApplicable without a track file and without an outline; the feed is the same', () => {
    const input: RaceInput = { miniSectors: race(), events: [collision(6, 5)] };
    const withTrack = runOutput(viewOf({ ...input, track: TRACK_T7 }));
    const noFile = runOutput(viewOf(input));
    expect(noFile.markers).toEqual(unknown('notApplicable'));
    expect(noFile.feed.map((e) => e.id)).toEqual(withTrack.feed.map((e) => e.id));
    const noOutline = runOutput(viewOf({ ...input, track: trackWith({ outline: unknown('notReceived') }) }));
    expect(noOutline.markers).toEqual(unknown('notApplicable'));
    expect(noOutline.feed).toEqual(withTrack.feed);
  });
});

describe("incidents: a marker lasts markerLaps of the leader's laps", () => {
  const LONG = 13;
  /** Car 6's mid-lap-10 place, 500 ms after its crossing (10, 24) at 857 400: on leader lap 10 (car 0 completed lap 9 at 810 000). */
  const ON_LAP_10 = 857_900;
  /** The view at time `t`: the history up to `t`, the leader's (car 0's) laps completed by then. */
  const at = (miniSectors: ReturnType<typeof race>, events: RaceEvent[], t: number, config: RaceInput['config'] = {}): EngineView =>
    viewOf({ miniSectors: until(miniSectors, t), events: until(events, t), laps: leaderLaps(LONG).filter((l) => l.frame <= t), track: TRACK_T7, config });
  /** Leader laps 10, 11 and 12: car 0 completed laps 9, 10 and 11 by then. */
  const LEADER_LAP_10 = 880_000;
  const LEADER_LAP_11 = 950_000;
  const LEADER_LAP_12 = 1_000_000;

  it('an entry on leader lap 10 is a marker on leader laps 10 and 11 and gone on 12', () => {
    const miniSectors = race({ laps: LONG });
    const events = [collision(6, 5, ON_LAP_10)];
    const kinds = (t: number) => markerList(runOutput(at(miniSectors, events, t))).map((m) => m.kind);
    expect(kinds(LEADER_LAP_10)).toEqual(['collision']);
    expect(kinds(LEADER_LAP_11)).toEqual(['collision']);
    expect(kinds(LEADER_LAP_12)).toEqual([]);
  });

  it("a lapped car's collision ages by the leader's laps: on leader lap 10 while the car is on its lap 9, a marker on leader laps 10 and 11, gone on 12", () => {
    // car 6 loses 95 s on lap 2: a lap down. Its (9, 24) is at 862 400; the collision 500 ms later is on leader lap 10.
    const lapped = race({ laps: LONG, delays: [{ carId: PLAYER, lap: 2, segment: 0, ms: 95_000 }] });
    const events = [collision(6, 5, 862_900)];
    const out = (t: number) => runOutput(at(lapped, events, t));
    expect(only(out(LEADER_LAP_10).feed, 'collision').lap).toBe(9);
    const collisions = (t: number) => markerList(out(t)).filter((m) => m.kind === 'collision');
    expect(collisions(LEADER_LAP_10)).toHaveLength(1);
    expect(collisions(LEADER_LAP_11)).toHaveLength(1);
    expect(collisions(LEADER_LAP_12)).toEqual([]);
  });

  it('a marker lasts the configured markerLaps: with 1 it is gone on leader lap 11', () => {
    const miniSectors = race({ laps: LONG });
    const events = [collision(6, 5, ON_LAP_10)];
    const view = (t: number) => at(miniSectors, events, t, { markerLaps: 1 });
    expect(markerList(runOutput(view(LEADER_LAP_10))).map((m) => m.kind)).toEqual(['collision']);
    expect(markerList(runOutput(view(LEADER_LAP_11)))).toEqual([]);
  });

  describe('after a flashback (C33)', () => {
    const miniSectors = race({ laps: LONG });
    const events = [collision(6, 5, ON_LAP_10)];
    const view = (t: number) => at(miniSectors, events, t);

    it('that undoes the laps after the marker went: the markers equal a fresh run without them, the marker back', () => {
      const [shown, gone, back] = [LEADER_LAP_10, LEADER_LAP_12, LEADER_LAP_11].map(view) as [EngineView, EngineView, EngineView];
      let acc = incidents.init(shown);
      expect(markerList(incidents.output(acc)).map((m) => m.kind)).toEqual(['collision']);
      acc = incidents.update(acc, deltaOf(shown, gone), gone);
      expect(markerList(incidents.output(acc))).toEqual([]);
      acc = incidents.update(acc, deltaOf(gone, back, true), back);
      const after = incidents.output(acc);
      expect(after).toEqual(runOutput(back));
      expect(markerList(after).map((m) => m.kind)).toEqual(['collision']);
    });

    it('that undoes the incident itself: the markers equal a fresh run without it, none', () => {
      const [shown, before] = [LEADER_LAP_10, ON_LAP_10 - 7_900].map(view) as [EngineView, EngineView];
      const acc = incidents.update(incidents.init(shown), deltaOf(shown, before, true), before);
      const after = incidents.output(acc);
      expect(after).toEqual(runOutput(before));
      expect(markerList(after)).toEqual([]);
    });
  });
});

describe('incidents: the accumulator holds nothing of the track file (C31.2)', () => {
  /** Another track file: its only turn `T9` 30 m before car 6's place at T, and the outline mirrored left to right. */
  const TRACK_T9 = trackWith({
    turns: known([turn('T9', F - 30 * M)], 0),
    outline: known(OUTLINE.map((p) => ({ x: 1 - p.x, y: p.y })), 0),
  });
  const miniSectors = race();
  const events = [collision(6, 5)];
  /** The history up to `t` (the collision and its crossings around it in by 410 000) with `track`. */
  const at = (t: number, track: EngineView['track']): EngineView => viewOf({ miniSectors: until(miniSectors, t), events, track });

  it('folded with one track file and output with another, it equals a fresh run with the other', () => {
    for (const [first, then, label] of [[TRACK_T7, TRACK_T9, 'T9'], [TRACK_T9, TRACK_T7, 'T7']] as const) {
      const stepped = stepsOutput([at(410_000, first), at(720_000, then)]);
      expect(stepped).toEqual(runOutput(at(720_000, then)));
      expect(only(stepped.feed, 'collision').where.turn).toMatchObject({ known: true, value: label });
    }
  });

  it('the two track files give different turns and markers, so the equality above tells them apart', () => {
    const t7 = runOutput(at(720_000, TRACK_T7));
    const t9 = runOutput(at(720_000, TRACK_T9));
    expect(only(t7.feed, 'collision').where.turn).toMatchObject({ known: true, value: 'T7' });
    expect(only(t9.feed, 'collision').where.turn).toMatchObject({ known: true, value: 'T9' });
    const { x, y } = pointAt(OUTLINE, F);
    expect(markerList(t9)).toEqual([{ kind: 'collision', point: { x: expect.closeTo(1 - x, 9), y: expect.closeTo(y, 9) } }]);
    expect(markerList(t7)).toEqual([markerAt('collision', F)]);
  });
});
