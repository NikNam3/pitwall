// The maths of `lap-times` (spec 6.2): bests and sector status per car, the session bests, and the board deltas.
import { known, unknown, type BestStatus, type CarId, type Known, type LapBoard, type LapBoardRow, type LapRecord, type Ms, type SectorStatus, type SessionBestTime } from '@pitwall/domain';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';

type Sectors<T> = [T, T, T];
const SECTORS = [0, 1, 2] as const;

/** A best time and the lap that set it. */
export type Best = { ms: Ms; lapNumber: number; completedAt: number };

/** A car's best lap and best valid sector times. */
export type CarBests = { lap?: Best | undefined; sectors: Sectors<Best | undefined> };

const faster = (a: Best | undefined, ms: Ms, lap: LapRecord): Best | undefined =>
  a === undefined || ms < a.ms ? { ms, lapNumber: lap.lapNumber, completedAt: lap.completedAt } : a;

/** The bests over a car's laps (in lap order); ties go to the earlier lap. */
export function bestsOf(laps: readonly LapRecord[], classes: LapClassOptions): CarBests {
  const bests: CarBests = { sectors: [undefined, undefined, undefined] };
  for (const lap of laps) {
    const { forBest } = classifyLap(lap, classes);
    if (forBest.lap) bests.lap = faster(bests.lap, lap.lapTimeMs, lap);
    for (const i of SECTORS) if (forBest.sectors[i]) bests.sectors[i] = faster(bests.sectors[i], lap.sectorTimesMs[i], lap);
  }
  return bests;
}

/** A session best with the lap that set it. */
export type Holder = Best & { carId: CarId };

/** The session bests over every car's bests; ties go to the earlier lap. */
export function sessionBestsOf(byCar: ReadonlyMap<CarId, CarBests>): { lap?: Holder | undefined; sectors: Sectors<Holder | undefined> } {
  const result: { lap?: Holder | undefined; sectors: Sectors<Holder | undefined> } = { sectors: [undefined, undefined, undefined] };
  const better = (a: Holder | undefined, b: Best | undefined, carId: CarId): Holder | undefined =>
    b !== undefined && (a === undefined || b.ms < a.ms || (b.ms === a.ms && b.completedAt < a.completedAt)) ? { ...b, carId } : a;
  for (const [carId, bests] of byCar) {
    result.lap = better(result.lap, bests.lap, carId);
    for (const i of SECTORS) result.sectors[i] = better(result.sectors[i], bests.sectors[i], carId);
  }
  return result;
}

/** How a time set on `lapNumber` ranks against the bests as they stand now. */
export function statusOf(valid: boolean, carId: CarId, lapNumber: number, own: Best | undefined, session: Holder | undefined): SectorStatus {
  if (!valid) return 'none';
  if (session?.carId === carId && session.lapNumber === lapNumber) return 'sessionBest';
  return own?.lapNumber === lapNumber ? 'personalBest' : 'none';
}

/** `sessionBest` when the car holds the session best: its own best is then that time (ties go to the holder only). */
const bestStatusOf = (carId: CarId, own: Best | undefined, session: Holder | undefined): BestStatus =>
  own !== undefined && session?.carId === carId ? 'sessionBest' : 'none';

const knownBest = (b: Best | undefined, missing: Known<Ms>): Known<Ms> => (b === undefined ? missing : known(b.ms, b.completedAt));
const knownHolder = (h: Holder | undefined): Known<SessionBestTime> => (h === undefined ? unknown('insufficientData') : known({ ms: h.ms, carId: h.carId }, h.completedAt));

/** The newest-sector fields of a board row, which `newestSectorsOf` adds. */
type NewestKeys = 'newestSectorsMs' | 'newestSectorStatus' | 'newestSectorOlder';

/** A board row without its deltas and its newest sectors. */
export type LapRowBase = Omit<LapBoardRow, 'deltaToReference' | NewestKeys>;

/**
 * One car's board row (without deltas and newest sectors) from its laps and the session bests. A time the car lacks is still to come
 * (`insufficientData`), or will not come once the car is `outOfRace` (`notApplicable`).
 */
export function rowOf(
  carId: CarId,
  laps: readonly LapRecord[],
  bests: CarBests,
  session: ReturnType<typeof sessionBestsOf>,
  classes: LapClassOptions,
  outOfRace: boolean,
): LapRowBase {
  const last = laps.length === 0 ? undefined : laps.reduce((a, b) => (b.lapNumber > a.lapNumber ? b : a));
  const lastClass = last === undefined ? undefined : classifyLap(last, classes).forBest;
  const unknownMs = unknown(outOfRace ? 'notApplicable' : 'insufficientData');
  const sectorsKnown = bests.sectors.every((s) => s !== undefined);
  return {
    carId,
    outOfRace,
    lastLapMs: last === undefined ? unknownMs : known(last.lapTimeMs, last.completedAt),
    lastSectorsMs: last === undefined ? [unknownMs, unknownMs, unknownMs] : (last.sectorTimesMs.map((ms) => known(ms, last.completedAt)) as Sectors<Known<Ms>>),
    lastSectorStatus:
      last === undefined || lastClass === undefined
        ? ['none', 'none', 'none']
        : (SECTORS.map((i) => statusOf(lastClass.sectors[i], carId, last.lapNumber, bests.sectors[i], session.sectors[i])) as Sectors<SectorStatus>),
    lastLapStatus: last === undefined || lastClass === undefined ? 'none' : statusOf(lastClass.lap, carId, last.lapNumber, bests.lap, session.lap),
    bestLapMs: knownBest(bests.lap, unknownMs),
    bestSectorsMs: bests.sectors.map((b) => knownBest(b, unknownMs)) as Sectors<Known<Ms>>,
    bestLapStatus: bestStatusOf(carId, bests.lap, session.lap),
    bestSectorStatus: SECTORS.map((i) => bestStatusOf(carId, bests.sectors[i], session.sectors[i])) as Sectors<BestStatus>,
    theoreticalBestMs: sectorsKnown
      ? known(
          bests.sectors.reduce((sum, s) => sum + (s as Best).ms, 0),
          Math.max(...bests.sectors.map((s) => (s as Best).completedAt)),
        )
      : unknownMs,
  };
}

/** What the live timing says of a car's current pass of its lap (spec 3.4). */
export type LivePass = {
  sector: 1 | 2 | 3;
  sector1TimeMs: Ms;
  sector2TimeMs: Ms;
  /** The pass restarted its lap: its own line crossing supersedes an earlier pass's (a garage restart, C25). */
  restarted: boolean;
  /** The current lap is invalid (its lap-validity span): its own sector times rank as no best. */
  invalid: boolean;
  /** The race-clock time of the lap's own line crossing (its current crossing of (car, lap, 0)); absent when none is recorded. */
  lineAt: number | undefined;
  /** When the live timing was read. */
  at: number;
};

const LIVE_SECTORS = [0, 1] as const;

/** A live S1 or S2 the pass has passed the end of, and when it finished (line + S1, line + S1 + S2). */
type LiveSector = { ms: Ms; finishedAt: number };

/**
 * The pass's own finished live sectors: the times it has passed the end of. 0 is the game's "no time yet" (C3). A time
 * the pass has not reached (the abandoned attempt's, on a restart) is none of them. Without a recorded line the finish
 * time is unknown and ranks after every known one.
 */
function ownLiveSectorsOf(live: LivePass): [LiveSector | undefined, LiveSector | undefined] {
  const s1 = live.sector > 1 && live.sector1TimeMs > 0 ? live.sector1TimeMs : undefined;
  const s2 = s1 !== undefined && live.sector > 2 && live.sector2TimeMs > 0 ? live.sector2TimeMs : undefined;
  const line = live.lineAt ?? Number.POSITIVE_INFINITY;
  if (s1 === undefined) return [undefined, undefined];
  return [{ ms: s1, finishedAt: line + s1 }, s2 === undefined ? undefined : { ms: s2, finishedAt: line + s1 + s2 }];
}

/** Who holds a sector column's best: a completed lap's (the session best of the lap records) or a live sector's. */
export type ColumnLeader = { carId: CarId; ms: Ms; at: number; live: boolean };

/**
 * Per sector column, the best time over the completed laps' session best and every car's finished live sectors of its
 * current pass, invalid laps excluded (spec 3.4). Strictly faster wins; an equal time goes to the one set earlier (a
 * lap record by its `completedAt`, a live sector by its finish time), then to the lower car id.
 */
export function columnLeadersOf(session: ReturnType<typeof sessionBestsOf>, passes: ReadonlyMap<CarId, LivePass>): Sectors<ColumnLeader | undefined> {
  const leaders = session.sectors.map((h): ColumnLeader | undefined => (h === undefined ? undefined : { carId: h.carId, ms: h.ms, at: h.completedAt, live: false })) as Sectors<ColumnLeader | undefined>;
  const beats = (b: ColumnLeader, a: ColumnLeader | undefined): boolean =>
    a === undefined || b.ms < a.ms || (b.ms === a.ms && (b.at < a.at || (b.at === a.at && b.carId < a.carId)));
  for (const [carId, live] of passes) {
    if (live.invalid) continue;
    const own = ownLiveSectorsOf(live);
    for (const i of LIVE_SECTORS) {
      const s = own[i];
      if (s === undefined) continue;
      const candidate: ColumnLeader = { carId, ms: s.ms, at: s.finishedAt, live: true };
      if (beats(candidate, leaders[i])) leaders[i] = candidate;
    }
  }
  return leaders;
}

type Newest = { ms: Known<Ms>; status: SectorStatus; older: boolean };

/** A live time against the car's own completed-lap best: strictly faster is a personal best. */
const personalStatusOf = (ms: Ms, own: Best | undefined): SectorStatus => (own === undefined || ms < own.ms ? 'personalBest' : 'none');

/**
 * The newest finished time per sector (spec 3.4): sectors 1 and 2 from the live timing once the current pass has
 * passed their end, else (and sector 3 always) the newest lap record's, judged as that record is. A time is older when
 * it belongs to an earlier pass than the newest one with a time: the lap just finished is not older until the current
 * pass has a sector of its own, and on a restarted pass every time before it is older, a live time the game still
 * shows from the abandoned attempt included. A time of the current pass on an invalid lap ranks `none`. `live` is absent for a car out of the race: its record times stand.
 * Only the column's leader (`columnLeadersOf`) is `sessionBest`: a lap record's session best a live sector beats ranks
 * as the car's own best, and an abandoned attempt's time ranks against the car's own bests only.
 */
export function newestSectorsOf(
  row: LapRowBase,
  live: LivePass | undefined,
  bests: CarBests,
  leaders: Sectors<ColumnLeader | undefined>,
): Pick<LapBoardRow, NewestKeys> {
  const passHasTime = live !== undefined && (live.sector > 1 || live.restarted);
  const newest: Newest[] = SECTORS.map((i) => {
    const status = row.lastSectorStatus[i];
    const beaten = status === 'sessionBest' && leaders[i]?.live === true;
    return { ms: row.lastSectorsMs[i], status: beaten ? 'personalBest' : status, older: passHasTime && row.lastSectorsMs[i].known };
  });
  if (live !== undefined) {
    for (const i of LIVE_SECTORS) {
      const ms = i === 0 ? live.sector1TimeMs : live.sector2TimeMs;
      const own = live.sector > i + 1;
      // 0 is the game's "no time yet" (C3); a time the pass has not reached is the abandoned attempt's, on a restart only
      if (ms <= 0 || (!own && !live.restarted)) continue;
      const leader = leaders[i];
      const status: SectorStatus = !own
        ? personalStatusOf(ms, bests.sectors[i])
        : live.invalid
          ? 'none'
          : leader?.live === true && leader.carId === row.carId
            ? 'sessionBest'
            : personalStatusOf(ms, bests.sectors[i]);
      newest[i] = { ms: known(ms, live.at), status, older: !own };
    }
  }
  return {
    newestSectorsMs: newest.map((n) => n.ms) as Sectors<Known<Ms>>,
    newestSectorStatus: newest.map((n) => n.status) as Sectors<SectorStatus>,
    newestSectorOlder: newest.map((n) => n.older) as Sectors<boolean>,
  };
}

/** The session-best part of the board. */
export function sessionBestBoard(session: ReturnType<typeof sessionBestsOf>): LapBoard['sessionBest'] {
  return { lap: knownHolder(session.lap), sectors: session.sectors.map(knownHolder) as LapBoard['sessionBest']['sectors'] };
}

/** `value − reference`, signed: positive = slower. Known since the later of the two; unknown for the row's reason first. */
export function delta(value: Known<Ms>, reference: Known<Ms>): Known<Ms> {
  if (!value.known) return unknown(value.reason);
  if (!reference.known) return unknown(reference.reason);
  return known(value.value - reference.value, Math.max(value.at, reference.at));
}

/** The board for a reference car: each row's deltas to the reference row's bests. */
export function boardFor(rows: readonly Omit<LapBoardRow, 'deltaToReference'>[], sessionBest: LapBoard['sessionBest'], referenceCarId: CarId): LapBoard | undefined {
  const ref = rows.find((r) => r.carId === referenceCarId);
  if (ref === undefined) return undefined;
  return {
    referenceCarId,
    rows: rows.map((r) => ({
      ...r,
      deltaToReference: {
        bestLapMs: delta(r.bestLapMs, ref.bestLapMs),
        bestSectorsMs: [0, 1, 2].map((i) => delta(r.bestSectorsMs[i] as Known<Ms>, ref.bestSectorsMs[i] as Known<Ms>)) as Sectors<Known<Ms>>,
        theoreticalBestMs: delta(r.theoreticalBestMs, ref.theoreticalBestMs),
      },
    })),
    sessionBest,
  };
}
