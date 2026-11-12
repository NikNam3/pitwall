// The shared time-loss detection (`shared/time-loss/`, plan Task 8; C43, C45): the time-loss, collision and damage
// events per car from the projection alone (its crossings and events, the damage jumps of `shared/damage-jumps.ts`),
// the pure part of `incidents` that `driver-noise` reads too, so both agree. The cases are those of
// `test/incidents/incidents.test.ts` (time loss, merging, damage), on the same races: the exclusions `incidents` takes
// from its spans (neutralisations, pit visits) come here as the caller's `excluded(carId, fromFrame, toFrame)`.
import { carId, type DamageParts, type RaceEvent } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { event } from '../../../../test-support/builders/index.ts';
import { timeLossEvents } from '../../src/shared/time-loss/index.ts';
import { boundaryAt, chain, race, SEGMENT_MS, until, viewOf, type Delay } from '../incidents/race.ts';

const car = carId;
type Events = ReturnType<typeof timeLossEvents>;

/**
 * The thresholds: `timeLossMs` and `mergeMs` the `incidents` config defaults, `jumpPct` and `jumpWindowMs` the `damage`
 * config defaults (the jump grouping's).
 */
const CONFIG = { timeLossMs: 2_000, mergeMs: 5_000, jumpPct: 5, jumpWindowMs: 2_000 };

/** Nothing excluded. */
const none = (): boolean => false;

/** A slow mini-sector of car 7 on lap 5, segment `segment` (it enters it at boundary (5, segment)). */
const slow7 = (ms: number, segment = 10): Delay => ({ carId: car(7), lap: 5, segment, ms });
/** Where car 7's slow mini-sector starts: its crossing (5, 10), on the frame numbered by its time (`race`). */
const SLOW_START = boundaryAt(7, 5, 10);
/** Where car 7's 2.5 s slow mini-sector ends: its crossing (5, 11). */
const SLOW_END = SLOW_START + SEGMENT_MS + 2_500;

/** A collision of cars `a` and `b` at `at`, on the frame numbered by its time (as `race` numbers its crossings). */
const collision = (a: number, b: number, at: number): RaceEvent => event({ kind: 'collision', at, frame: at, carId: car(a), otherCarId: car(b) });
/** A `damageChange` event of car `id` (car 7 by default) at `at`, on the frame numbered by its time. */
const dmg = (at: number, part: keyof DamageParts, fromPct: number, toPct: number, id = 7): RaceEvent =>
  event({ kind: 'damageChange', at, frame: at, carId: car(id), params: { part, fromPct, toPct } });

/** The projection of a race with these delays and events. */
const historyOf = (delays: Delay[] = [], events: RaceEvent[] = []) => viewOf({ miniSectors: race({ delays }), events }).history;

/** The caller's exclusion of the frames `[startFrame, endFrame)` of car `id`: a mini-sector sharing a frame with them (C26). */
const framesOf =
  (id: number, startFrame: number, endFrame: number) =>
  (c: number, fromFrame: number, toFrame: number): boolean =>
    c === id && fromFrame < endFrame && toFrame > startFrame;

const ofKind = (events: Events, kind: Events[number]['kind']): Events => events.filter((e) => e.kind === kind);

describe('timeLossEvents', () => {
  describe('time loss (ported from incidents)', () => {
    it("a mini-sector 2.5 s slower than the car's median is a timeLoss event; 1.5 s is none", () => {
      expect(timeLossEvents(historyOf([slow7(2_500)]), CONFIG, none)).toEqual([{ carId: car(7), lap: 5, frame: SLOW_START, lossMs: 2_500, kind: 'timeLoss' }]);
      expect(timeLossEvents(historyOf([slow7(1_500)]), CONFIG, none)).toEqual([]);
    });

    it('the threshold is the config: with timeLossMs 1000 the 1.5 s mini-sector is a timeLoss', () => {
      expect(timeLossEvents(historyOf([slow7(1_500)]), { ...CONFIG, timeLossMs: 1_000 }, none)).toEqual([
        { carId: car(7), lap: 5, frame: SLOW_START, lossMs: 1_500, kind: 'timeLoss' },
      ]);
    });

    it("two slow mini-sectors in a row are one timeLoss event from the first one's start, with their losses summed", () => {
      const events = timeLossEvents(historyOf([slow7(2_500, 10), slow7(2_500, 11)]), CONFIG, none);
      expect(events).toEqual([{ carId: car(7), lap: 5, frame: SLOW_START, lossMs: 5_000, kind: 'timeLoss' }]);
    });

    it('a slow mini-sector the caller excludes (an SC, a pit visit, a garage spell of the car) is no timeLoss', () => {
      const history = historyOf([slow7(2_500)]);
      // an SC over every car, a pit visit of car 7, a garage spell of car 7: as incidents passes them
      const sc = (_c: number, from: number, to: number) => from < SLOW_START + 30_000 && to > SLOW_START - 10_000;
      expect(timeLossEvents(history, CONFIG, sc)).toEqual([]);
      expect(timeLossEvents(history, CONFIG, framesOf(7, SLOW_START + 1_000, SLOW_START + 20_000))).toEqual([]);
    });

    it("another car's exclusion excludes nothing of car 7", () => {
      const events = timeLossEvents(historyOf([slow7(2_500)]), CONFIG, framesOf(6, SLOW_START + 1_000, SLOW_START + 20_000));
      expect(events.map((e) => [e.carId, e.frame])).toEqual([[car(7), SLOW_START]]);
    });

    it("exclusion by frame: a range opening on the frame before the slow mini-sector's end crossing excludes it, one opening on that crossing's frame does not (C26)", () => {
      const history = historyOf([slow7(2_500)]);
      expect(timeLossEvents(history, CONFIG, framesOf(7, SLOW_END - 1, SLOW_END + 20_000))).toEqual([]);
      expect(ofKind(timeLossEvents(history, CONFIG, framesOf(7, SLOW_END, SLOW_END + 20_000)), 'timeLoss')).toHaveLength(1);
    });

    it("the caller is asked with each mini-sector's car and its start and end crossings' frames, never their times (C26)", () => {
      // frames apart from times: each crossing describes the frame numbered by its position in the list
      const miniSectors = race({ delays: [slow7(2_500)] }).map((c, i) => ({ ...c, frame: i + 1 }));
      const frameOf = (at: number) => miniSectors.find((c) => c.carId === car(7) && c.at === at)!.frame;
      const calls: Array<[number, number, number]> = [];
      const events = timeLossEvents(viewOf({ miniSectors }).history, CONFIG, (c, from, to) => {
        calls.push([c, from, to]);
        return false;
      });
      expect(calls).toContainEqual([car(7), frameOf(SLOW_START), frameOf(SLOW_END)]);
      expect(events).toEqual([{ carId: car(7), lap: 5, frame: frameOf(SLOW_START), lossMs: 2_500, kind: 'timeLoss' }]);
    });

    it("an excluded mini-sector is no sample of the median: excluded slow ones do not lift a later lap's median", () => {
      // car 7 slow by 2.5 s in segment 10 on laps 4, 5, 6 and 8 of 10. Counted, laps 4–6 would lift lap 8's median to
      // 4 300 ms (no time loss); excluded, its median is 1 800 ms over laps 1–3 and 7, and lap 8 loses 2.5 s.
      const delays = [4, 5, 6, 8].map((lap): Delay => ({ carId: car(7), lap, segment: 10, ms: 2_500 }));
      const miniSectors = race({ laps: 10, delays });
      const startOn = (lap: number) => miniSectors.find((c) => c.carId === car(7) && c.lap === lap && c.segment === 10)!.frame;
      const excludedStarts = new Set([4, 5, 6].map(startOn));
      const history = viewOf({ miniSectors }).history;
      const events = timeLossEvents(history, CONFIG, (c, from) => c === car(7) && excludedStarts.has(from));
      expect(events).toEqual([{ carId: car(7), lap: 8, frame: startOn(8), lossMs: 2_500, kind: 'timeLoss' }]);
      expect(ofKind(timeLossEvents(history, CONFIG, none), 'timeLoss').map((e) => e.lap)).not.toContain(8);
    });

    it('reads only the history it is given: a prefix up to the slow mini-sector\'s end has the event, one before it none', () => {
      const all = race({ delays: [slow7(2_500)] });
      expect(timeLossEvents(viewOf({ miniSectors: until(all, SLOW_END) }).history, CONFIG, none)).toHaveLength(1);
      expect(timeLossEvents(viewOf({ miniSectors: until(all, SLOW_END - 1) }).history, CONFIG, none)).toEqual([]);
    });
  });

  describe('collisions, with a time loss merged (ported from incidents, ruling 4)', () => {
    const delays = [slow7(3_000)];

    it("a timeLoss within mergeMs of a collision of the car is that car's collision event's loss, no timeLoss event; the other car's collision event has its own mini-sector's loss", () => {
      const at = SLOW_START - 2_000;
      const events = timeLossEvents(historyOf(delays, [collision(7, 8, at)]), CONFIG, none);
      expect(events).toEqual([
        { carId: car(7), lap: 5, frame: at, lossMs: 3_000, kind: 'collision' },
        { carId: car(8), lap: 5, frame: at, lossMs: 0, kind: 'collision' },
      ]);
    });

    it('a timeLoss of the second car of a collision (otherCarId) merges into its collision event', () => {
      const at = SLOW_START - 2_000;
      const events = timeLossEvents(historyOf(delays, [collision(8, 7, at)]), CONFIG, none);
      expect(ofKind(events, 'timeLoss')).toEqual([]);
      expect(events.find((e) => e.carId === car(7))).toEqual({ carId: car(7), lap: 5, frame: at, lossMs: 3_000, kind: 'collision' });
    });

    it('a timeLoss more than mergeMs from the collision, or of another car, stays its own event', () => {
      const far = timeLossEvents(historyOf(delays, [collision(7, 8, SLOW_START - 8_000)]), CONFIG, none);
      expect(far.filter((e) => e.carId === car(7)).map((e) => [e.kind, e.lossMs])).toEqual([
        ['collision', 0],
        ['timeLoss', 3_000],
      ]);
      const other = timeLossEvents(historyOf(delays, [collision(8, 9, SLOW_START - 2_000)]), CONFIG, none);
      expect(other.map((e) => [e.carId, e.kind])).toEqual([
        [car(8), 'collision'],
        [car(9), 'collision'],
        [car(7), 'timeLoss'],
      ]);
    });

    it('mergeMs is the config: with mergeMs 1000 a collision 2 s before stays apart from the timeLoss', () => {
      const events = timeLossEvents(historyOf(delays, [collision(7, 8, SLOW_START - 2_000)]), { ...CONFIG, mergeMs: 1_000 }, none);
      expect(events.filter((e) => e.carId === car(7)).map((e) => e.kind)).toEqual(['collision', 'timeLoss']);
    });

    it('a collision event names the lap its car was on at the collision, from its crossings', () => {
      // car 6's boundaries (5, 24) and (5, 25) are 407 400 and 409 200: mid-lap 5
      const events = timeLossEvents(historyOf([], [collision(6, 5, 407_900)]), CONFIG, none);
      expect(events.map((e) => [e.carId, e.lap, e.kind])).toEqual([
        [car(5), 5, 'collision'],
        [car(6), 5, 'collision'],
      ]);
    });
  });

  describe('damage (ported from incidents)', () => {
    it("a timeLoss within mergeMs of a damage jump of the car is the damage event's loss, no timeLoss event", () => {
      const at = SLOW_START + 1_000;
      expect(timeLossEvents(historyOf([slow7(3_000)], [dmg(at, 'floorPct', 0, 30)]), CONFIG, none)).toEqual([
        { carId: car(7), lap: 5, frame: at, lossMs: 3_000, kind: 'damage' },
      ]);
    });

    it('a damage jump with no time loss near it carries its mini-sector\'s loss', () => {
      expect(timeLossEvents(historyOf([], [dmg(407_900, 'frontLeftWingPct', 0, 20)]), CONFIG, none)).toEqual([
        { carId: car(7), lap: 5, frame: 407_900, lossMs: 0, kind: 'damage' },
      ]);
    });

    it('the jump grouping follows the config: a 3 % rise is no event by default and one with jumpPct 3', () => {
      const history = historyOf([], [dmg(407_900, 'floorPct', 0, 3)]);
      expect(timeLossEvents(history, CONFIG, none)).toEqual([]);
      expect(ofKind(timeLossEvents(history, { ...CONFIG, jumpPct: 3 }, none), 'damage')).toHaveLength(1);
    });

    it("jumps of the car within jumpWindowMs of the first one are one event, on the first jump's frame", () => {
      const T = 407_900;
      const events = timeLossEvents(historyOf([], [dmg(T, 'frontLeftWingPct', 0, 12), dmg(T + 500, 'floorPct', 0, 20), dmg(T + 3_000, 'rearWingPct', 0, 8)]), CONFIG, none);
      expect(events.map((e) => [e.kind, e.frame])).toEqual([
        ['damage', T],
        ['damage', T + 3_000],
      ]);
    });

    it('a repair (a fall of the part) changes nothing: the damage event and its merged loss stay, no timeLoss appears', () => {
      const hit = SLOW_START + 1_000;
      const hitOnly = [dmg(hit, 'frontRightWingPct', 0, 37)];
      const repaired = [...hitOnly, dmg(hit + 90_000, 'frontRightWingPct', 37, 0)];
      const events = timeLossEvents(historyOf([slow7(3_000)], repaired), CONFIG, none);
      expect(events).toEqual([{ carId: car(7), lap: 5, frame: hit, lossMs: 3_000, kind: 'damage' }]);
      expect(events).toEqual(timeLossEvents(historyOf([slow7(3_000)], hitOnly), CONFIG, none));
    });

    it("the user's case: three hits on the front-right wing, each followed by a change, are three damage events", () => {
      // from lap 4 on, where car 7's mini-sectors have their median (three laps before)
      const events = [
        dmg(300_000, 'frontRightWingPct', 0, 37),
        dmg(350_000, 'frontRightWingPct', 37, 0),
        dmg(400_000, 'frontRightWingPct', 0, 33),
        dmg(450_000, 'frontRightWingPct', 33, 0),
        dmg(550_000, 'frontRightWingPct', 0, 30),
      ];
      expect(timeLossEvents(historyOf([], events), CONFIG, none).map((e) => [e.kind, e.frame, e.lossMs])).toEqual([
        ['damage', 300_000, 0],
        ['damage', 400_000, 0],
        ['damage', 550_000, 0],
      ]);
    });
  });

  describe('every car alike', () => {
    it('in frame order, ties by car id', () => {
      const delays = [{ carId: car(3), lap: 4, segment: 20, ms: 2_500 }, slow7(2_500)];
      const events = timeLossEvents(historyOf(delays, [collision(9, 2, SLOW_START + 40_000)]), CONFIG, none);
      expect(events.map((e) => [e.carId, e.kind, e.frame])).toEqual([
        [car(3), 'timeLoss', boundaryAt(3, 4, 20)],
        [car(7), 'timeLoss', SLOW_START],
        [car(2), 'collision', SLOW_START + 40_000],
        [car(9), 'collision', SLOW_START + 40_000],
      ]);
    });

    it("a human slot with an empty name (online names hidden) gets its events like any car: the history alone decides, not who drives", () => {
      const events = [collision(7, 8, SLOW_START - 2_000), dmg(450_000, 'floorPct', 0, 30)];
      const ai = viewOf({ miniSectors: race({ delays: [slow7(3_000)] }), events }).history;
      // car 7 driven by a human since the engine joined: its car-driver span, as the projection holds it (C20)
      const spans = chain('car-driver', 7, [{ kind: 'human', at: 0, joinedAt: true }], 600_000);
      const human = viewOf({ miniSectors: race({ delays: [slow7(3_000)] }), events, spans }).history;
      expect(timeLossEvents(human, CONFIG, none)).toEqual(timeLossEvents(ai, CONFIG, none));
      expect(timeLossEvents(human, CONFIG, none).filter((e) => e.carId === car(7)).map((e) => e.kind)).toEqual(['collision', 'damage']);
    });
  });
});
