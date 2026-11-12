// The following episodes (SP4.3a spec 5.4, 5.5): a faster car held behind another, zone by zone, as the pass curve's fit
// and the calculator both read them (C43), and the spec 5.5 lap filter they share.
//  - A car is held at a braking zone when it reaches the zone's start within `minGapMs` (plus `heldSlackMs`) of the car
//    directly ahead of it on the same lap (race order, from the interpolated crossings) and is at least as fast. It passed
//    there when it is ahead of that car at the next braking zone. An instance whose lap, or the next zone's lap, either
//    car's filter leaves out gives no zone: a pass caused by a stop or made on lap 1 never counts.
//  - Its pace advantage is the leader's pace minus its own, each the median of the car's free-air laps' residuals
//    against the field's median lap (its usable laps' when it never had free air), so the race's fuel and tyre trend cancel.
//  - DRS is relative (spec 5.4): the follower is within `drsRangeMs` of the car ahead at the detection point of the DRS
//    zone that leads into the braking zone, and that car is not itself within range of its own car ahead.
import {
  carStatusSpans,
  currentLaps,
  MINI_SECTORS,
  sessionPhaseRaceSpans,
  type CarId,
  type DamageParts,
  type FrameNumber,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type OpenSpan,
  type Span,
  type TrackData,
} from '@pitwall/domain';
import { membershipOf, type DeepReadonly, type MembershipSource, type Projection } from '@pitwall/engine/readers';
import { RACE_INTERACTION_BEHAVIOUR } from './behaviour.ts';
import type { RaceInteractionConfig } from './config.ts';

/** One braking zone passed while following: its index in the track's braking zones, the pace advantage, and what happened. */
export type EpisodeZone = { zone: number; advantageMs: number; drs: boolean; wet: boolean; passed: boolean };

/** A follower held behind one leader, zone by zone. */
export type FollowingEpisode = { follower: CarId; leader: CarId; zones: EpisodeZone[] };

/** What the lap filter reads besides the lap: the projection with its situation (membership, C26) and the config (C47). */
export type LapFilterCtx = { source: MembershipSource; config: RaceInteractionConfig };

/** Which laps of a follower may hold a zone besides the filter's (a calibration source's stint minus its excluded laps). */
export type FollowerLaps = (car: CarId, lap: number) => boolean;

const PHASE = sessionPhaseRaceSpans.machine;
const STATUS = carStatusSpans.machine;

/** The machines whose spans exclude a lap by its membership (the behaviour table's `excludesLap` rows). */
const FILTER_MACHINES: readonly MachineId[] = [PHASE, STATUS];

/** The wings: a car with this damage follows differently (gearbox and engine damage do not change how it follows). */
const AERO_PARTS = ['frontLeftWingPct', 'frontRightWingPct', 'rearWingPct'] as const satisfies readonly (keyof DamageParts)[];

/** The spec 5.5 lap filter: lap 1, in- and out-laps, SC, VSC and formation laps, a car with aero damage of 10 % or more. */
export function excludedLap(lap: DeepReadonly<LapRecord>, ctx: LapFilterCtx): boolean {
  return excludedByLap(lap, ctx.config) || excludedByMembership(membershipOf(ctx.source, lap));
}

/** The lap filter's checks on the lap record itself (the cheap ones, so membership runs only for the laps they keep). */
function excludedByLap(lap: DeepReadonly<LapRecord>, config: RaceInteractionConfig): boolean {
  if (lap.lapNumber <= 1 || lap.inLap || lap.outLap || lap.scShare > 0 || lap.vscShare > 0) return true;
  const damage = lap.damageAtEnd;
  return damage.known && AERO_PARTS.some((part) => damage.value[part] >= config.aeroDamageMaxPct);
}

/** The lap filter's check on a lap's membership (C26): a span the behaviour table excludes. */
function excludedByMembership(member: Readonly<Record<MachineId, DeepReadonly<OpenSpan>>>): boolean {
  for (const machine of FILTER_MACHINES) {
    const span = member[machine];
    if (span === undefined) continue;
    const row = RACE_INTERACTION_BEHAVIOUR[machine]?.[span.kind];
    if (row === undefined) throw new Error(`race-interaction: no behaviour row for ${machine} ${span.kind}`);
    if (row.excludesLap === true) return true;
  }
  return false;
}

/** Every following episode of `history` on `track`'s braking zones; laps `excludedLap` leaves out give no zone. */
export function followingEpisodes(history: Projection, track: DeepReadonly<TrackData>, config: RaceInteractionConfig): FollowingEpisode[] {
  return episodesOf({ history }, track, config);
}

/** A point of the lap by fraction: its mini-sector and how far into it. */
type Point = { segment: number; within: number };

const pointOf = (fraction: number): Point => {
  const x = fraction * MINI_SECTORS;
  const segment = Math.min(MINI_SECTORS - 1, Math.max(0, Math.floor(x)));
  return { segment, within: x - segment };
};

/** Within this of a segment's start a point is the crossing itself (float rounding of `fraction × 50`). */
const AT_CROSSING = 1e-9;

/** A projection without facts: the lap filter's sources hold only the spans of its machines. */
const NO_FACTS = { laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], appendedAt: {} } as const;

/** The number of entries of the ascending `xs` at or below `x`. */
const countAtOrBelow = (xs: readonly number[], x: number): number => {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? Number.POSITIVE_INFINITY) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * The membership half of the lap filter for `source`, per car: whether a lap of that car (its car id and the frame it
 * describes) lies in a span the behaviour table excludes. Membership comes from `membershipOf` over the car's own source
 * (`filterSources`); a car's frames between the same two span boundaries (a span's start or end frame, C26) share one
 * membership, so it is computed once per such stretch.
 */
function membershipFilter(source: MembershipSource): (lap: { carId: CarId; frame: FrameNumber }) => boolean {
  const sourceOf = filterSources(source);
  const memo = new Map<CarId, { boundaries: number[]; excluded: Map<number, boolean> }>();
  return (lap) => {
    const own = sourceOf(lap.carId);
    let car = memo.get(lap.carId);
    if (car === undefined) {
      const frames = new Set<number>();
      const spanLists = [...Object.values(own.history.spans), ...Object.values(own.situation?.byMachine ?? {})];
      for (const spans of spanLists) {
        for (const span of spans as readonly DeepReadonly<OpenSpan & { endFrame?: FrameNumber }>[]) {
          frames.add(span.startFrame);
          if (span.endFrame !== undefined) frames.add(span.endFrame);
        }
      }
      car = { boundaries: [...frames].sort((a, b) => a - b), excluded: new Map() };
      memo.set(lap.carId, car);
    }
    const stretch = countAtOrBelow(car.boundaries, lap.frame);
    let excluded = car.excluded.get(stretch);
    if (excluded === undefined) {
      excluded = excludedByMembership(membershipOf(own, lap));
      car.excluded.set(stretch, excluded);
    }
    return excluded;
  };
}

/**
 * Per car, the membership source of the lap filter: the session phase's spans and only that car's car-status spans, so
 * membership (C26) lists nothing else (C41) and matches few spans per lap.
 */
function filterSources(source: MembershipSource): (car: CarId) => MembershipSource {
  const byCar = <T extends { carId?: CarId }>(spans: readonly DeepReadonly<T>[] | undefined): Map<CarId, DeepReadonly<T>[]> => {
    const grouped = new Map<CarId, DeepReadonly<T>[]>();
    for (const span of spans ?? []) {
      if (span.carId === undefined) continue;
      const list = grouped.get(span.carId);
      if (list === undefined) grouped.set(span.carId, [span]);
      else list.push(span);
    }
    return grouped;
  };
  const closedPhase = source.history.spans[PHASE] ?? [];
  const closedStatus = byCar<Span>(source.history.spans[STATUS]);
  const situation = source.situation;
  const openPhase = situation?.byMachine[PHASE] ?? [];
  const openStatus = byCar<OpenSpan>(situation?.byMachine[STATUS]);
  const sources = new Map<CarId, MembershipSource>();
  return (car) => {
    let own = sources.get(car);
    if (own === undefined) {
      own = {
        history: { ...NO_FACTS, spans: { [PHASE]: closedPhase, [STATUS]: closedStatus.get(car) ?? [] } },
        ...(situation !== undefined && { situation: { weekendPhase: situation.weekendPhase, byMachine: { [PHASE]: openPhase, [STATUS]: openStatus.get(car) ?? [] } } }),
      };
      sources.set(car, own);
    }
    return own;
  };
}

/** Entry `i` of `xs`, NaN outside it. */
const nth = (xs: ArrayLike<number>, i: number): number => xs[i] ?? Number.NaN;

/** The median of a non-empty list (sorts it). */
const median = (values: number[]): number => {
  const sorted = values.sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? nth(sorted, mid) : (nth(sorted, mid - 1) + nth(sorted, mid)) / 2;
};

/** The race order at one point of one lap: the cars that passed it by time, their times, and each car's rank (-1 without). */
type Order = { cars: CarId[]; at: number[]; rank: Int16Array };

/**
 * The following episodes of `source` (its projection, and its situation's open spans for the filter's membership), on
 * `track`'s braking zones; `followerLaps` narrows which follower laps count. The calculator's and the priors' one rule (C43).
 */
export function episodesOf(source: MembershipSource, track: DeepReadonly<TrackData>, config: RaceInteractionConfig, followerLaps?: FollowerLaps): FollowingEpisode[] {
  if (!track.brakingZones.known || track.brakingZones.value.length === 0) return [];
  const brakingStarts = track.brakingZones.value.map((z) => z.start).sort((a, b) => a - b);
  const zoneCount = brakingStarts.length;
  const drsZones = track.drsZones.known ? track.drsZones.value : [];
  const history = source.history;

  // the points read, by index: the line (0), each braking zone's start (1 + z), the DRS detection points after them
  const points: Point[] = [{ segment: 0, within: 0 }, ...brakingStarts.map(pointOf)];
  /** Per braking zone, the point index of the detection point of the DRS zone leading into it, and whether it lies on the lap before. */
  const drsFeed = brakingStarts.map((start) => {
    const zone = drsZones.find((d) => firstZoneAfter(brakingStarts, d.end) === start);
    if (zone === undefined) return undefined;
    points.push(pointOf(zone.detection));
    return { point: points.length - 1, lapBefore: zone.detection > start };
  });
  const pointCount = points.length;
  // the segments read (each point's and the next), by column of the crossing table: -1 for a segment not read
  const column = new Int8Array(MINI_SECTORS).fill(-1);
  let columns = 0;
  for (const p of points) {
    for (const segment of [p.segment, (p.segment + 1) % MINI_SECTORS]) if (column[segment] === -1) column[segment] = columns++;
  }

  // the current laps (C25) by car and lap number
  const lapsOf: (DeepReadonly<LapRecord> | undefined)[][] = [];
  let lastLap = 0;
  let carSlots = 0;
  const current = currentLaps(history.laps as readonly LapRecord[]);
  for (const lap of current) {
    (lapsOf[lap.carId] ??= [])[lap.lapNumber] = lap;
    lastLap = Math.max(lastLap, lap.lapNumber);
    carSlots = Math.max(carSlots, lap.carId + 1);
  }
  const laps = lastLap + 2;
  const cars: CarId[] = [];
  for (let car = 0; car < carSlots; car++) if (lapsOf[car] !== undefined) cars.push(car as CarId);

  // the current crossings (C25) at the segments read: their times by car, lap and segment (NaN without one). Written in
  // log order, a later crossing of a slot over an earlier one: the domain's rule `foldCurrentCrossing` (its index holds
  // exactly `currentCrossings` by car, lap and segment), kept in a typed array; the domain's Map index costs this
  // from-scratch run about 4 ms over the ~69k crossings of a long race (a typed form in `domain` is requested)
  const at = new Float64Array(carSlots * laps * columns).fill(Number.NaN);
  const crossings = history.crossings as readonly MiniSectorCrossing[];
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i] as MiniSectorCrossing;
    const k = column[c.segment] ?? -1;
    if (k >= 0 && c.carId < carSlots && c.lap < laps) at[(c.carId * laps + c.lap) * columns + k] = c.at;
  }
  const crossingAt = (car: number, lap: number, segment: number): number => {
    const k = column[segment] ?? -1;
    return lap < laps && k >= 0 ? nth(at, (car * laps + lap) * columns + k) : Number.NaN;
  };
  const lapOf = (car: CarId, lap: number): DeepReadonly<LapRecord> | undefined => lapsOf[car]?.[lap];

  // the usable laps: those the filter keeps (membership through each car's own source)
  const excludedByMember = membershipFilter(source);
  const usable: Uint8Array[] = [];
  for (const lap of current) {
    if (!excludedByLap(lap, config) && !excludedByMember(lap)) (usable[lap.carId] ??= new Uint8Array(laps))[lap.lapNumber] = 1;
  }
  const isUsable = (car: CarId, lap: number): boolean => usable[car]?.[lap] === 1;

  // each car's time at each point of each lap (NaN where it has no crossing there), then the order there
  const times = new Float64Array(carSlots * laps * pointCount).fill(Number.NaN);
  const slot = (car: number, lap: number, p: number): number => (car * laps + lap) * pointCount + p;
  for (const car of cars) {
    for (let lap = 1; lap < laps; lap++) {
      for (let p = 0; p < pointCount; p++) {
        const { segment, within } = points[p] as Point;
        const t0 = crossingAt(car, lap, segment);
        if (Number.isNaN(t0)) continue;
        if (within < AT_CROSSING) {
          times[slot(car, lap, p)] = t0;
          continue;
        }
        const t1 = segment + 1 < MINI_SECTORS ? crossingAt(car, lap, segment + 1) : crossingAt(car, lap + 1, 0);
        if (!Number.isNaN(t1)) times[slot(car, lap, p)] = t0 + within * (t1 - t0);
      }
    }
  }
  const timeAt = (car: CarId, lap: number, p: number): number => (lap < laps ? nth(times, slot(car, lap, p)) : Number.NaN);
  const orders: (Order | undefined)[] = new Array(laps * pointCount);
  const orderAt = (lap: number, p: number): Order => {
    const key = lap * pointCount + p;
    let order = orders[key];
    if (order === undefined) {
      // insertion by time, ties by car id (cars come in id order): a field of about 20 cars
      const byRank: CarId[] = [];
      const at: number[] = [];
      for (const car of cars) {
        const t = timeAt(car, lap, p);
        if (Number.isNaN(t)) continue;
        let i = at.length;
        byRank.push(car);
        at.push(t);
        for (; i > 0 && nth(at, i - 1) > t; i--) {
          byRank[i] = byRank[i - 1] as CarId;
          at[i] = nth(at, i - 1);
        }
        byRank[i] = car;
        at[i] = t;
      }
      const rank = new Int16Array(carSlots).fill(-1);
      for (const [i, car] of byRank.entries()) rank[car] = i;
      order = { cars: byRank, at, rank };
      orders[key] = order;
    }
    return order;
  };
  /** The gap of `car` to the car directly ahead at point `p` of `lap`, else NaN (it leads, or did not pass it). */
  const gapAhead = (lap: number, p: number, car: CarId): number => {
    if (lap >= laps) return Number.NaN;
    const order = orderAt(lap, p);
    const i = order.rank[car] ?? -1;
    return i <= 0 ? Number.NaN : nth(order.at, i) - nth(order.at, i - 1);
  };

  // each car's pace: the median residual of its free-air laps against the field's median lap, else of its usable laps
  const fieldMedian = new Float64Array(laps).fill(Number.NaN);
  for (let lap = 1; lap <= lastLap; lap++) {
    const lapTimes: number[] = [];
    for (const car of cars) {
      const record = lapOf(car, lap);
      if (record !== undefined && isUsable(car, lap)) lapTimes.push(record.lapTimeMs);
    }
    if (lapTimes.length > 0) fieldMedian[lap] = median(lapTimes);
  }
  const pace = new Float64Array(carSlots).fill(Number.NaN);
  const inFreeAir = (gap: number): boolean => Number.isNaN(gap) || gap >= config.freeAirGapMs;
  for (const car of cars) {
    const free: number[] = [];
    const all: number[] = [];
    for (let lap = 1; lap <= lastLap; lap++) {
      const record = lapOf(car, lap);
      if (record === undefined || !isUsable(car, lap)) continue;
      const residual = record.lapTimeMs - nth(fieldMedian, lap);
      all.push(residual);
      if (inFreeAir(gapAhead(lap, 0, car)) && inFreeAir(gapAhead(lap + 1, 0, car))) free.push(residual);
    }
    if (all.length > 0) pace[car] = median(free.length > 0 ? free : all);
  }

  /** Whether `car` has DRS at braking zone `z` of lap `lap` (relative: the car ahead is not itself in range). */
  const drsAt = (car: CarId, lap: number, z: number): boolean => {
    const feed = drsFeed[z];
    if (feed === undefined || lap < config.drsFromLap) return false;
    const detectionLap = feed.lapBefore ? lap - 1 : lap;
    const order = orderAt(detectionLap, feed.point);
    const i = order.rank[car] ?? -1;
    if (i <= 0 || nth(order.at, i) - nth(order.at, i - 1) > config.drsRangeMs) return false;
    return i === 1 || nth(order.at, i - 1) - nth(order.at, i - 2) > config.drsRangeMs;
  };

  const heldGapMs = config.minGapMs + config.heldSlackMs;
  const episodes: FollowingEpisode[] = [];
  /** The open episode of each (follower, leader) pair, by `follower × slots + leader`, and the sequence number of its last zone. */
  const open = new Map<number, { episode: FollowingEpisode; seq: number }>();
  for (let lap = 2; lap <= lastLap; lap++) {
    for (let z = 0; z < zoneCount; z++) {
      const p = 1 + z;
      const nextLap = z + 1 < zoneCount ? lap : lap + 1;
      const nextP = 1 + ((z + 1) % zoneCount);
      const seq = (lap - 1) * zoneCount + z;
      const order = orderAt(lap, p);
      for (let i = 1; i < order.cars.length; i++) {
        const follower = order.cars[i];
        const leader = order.cars[i - 1];
        if (follower === undefined || leader === undefined || nth(order.at, i) - nth(order.at, i - 1) > heldGapMs) continue;
        if (!isUsable(follower, lap) || !isUsable(leader, lap) || !isUsable(follower, nextLap) || !isUsable(leader, nextLap)) continue;
        if (followerLaps !== undefined && !followerLaps(follower, lap)) continue;
        const followerNext = timeAt(follower, nextLap, nextP);
        const leaderNext = timeAt(leader, nextLap, nextP);
        const advantageMs = Math.round(nth(pace, leader) - nth(pace, follower));
        // a slower car behind is not held: only a car at least as fast follows (spec 5.4)
        if (Number.isNaN(followerNext) || Number.isNaN(leaderNext) || Number.isNaN(advantageMs) || advantageMs < 0) continue;
        const compound = lapOf(follower, lap)?.visualCompound;
        const zone: EpisodeZone = {
          zone: z,
          advantageMs,
          drs: drsAt(follower, lap, z),
          wet: compound === 'inter' || compound === 'wet',
          passed: followerNext < leaderNext,
        };
        const pair = follower * carSlots + leader;
        const last = open.get(pair);
        if (last !== undefined && last.seq === seq - 1) {
          last.episode.zones.push(zone);
          last.seq = seq;
        } else {
          const episode: FollowingEpisode = { follower, leader, zones: [zone] };
          episodes.push(episode);
          open.set(pair, { episode, seq });
        }
      }
    }
  }
  return episodes;
}

/** The first braking zone start at or after `fraction` around the lap. */
function firstZoneAfter(starts: readonly number[], fraction: number): number {
  return starts.find((s) => s >= fraction) ?? starts[0] ?? fraction;
}
