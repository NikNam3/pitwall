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

/**
 * One car's board row (without deltas) from its laps and the session bests. A time the car lacks is still to come
 * (`insufficientData`), or will not come once the car is `outOfRace` (`notApplicable`).
 */
export function rowOf(
  carId: CarId,
  laps: readonly LapRecord[],
  bests: CarBests,
  session: ReturnType<typeof sessionBestsOf>,
  classes: LapClassOptions,
  outOfRace: boolean,
): Omit<LapBoardRow, 'deltaToReference'> {
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
  /** When the live timing was read. */
  at: number;
};

type Newest = { ms: Known<Ms>; status: SectorStatus; older: boolean };

/** A live sector time against the bests of the lap records, which it is not yet part of: strictly faster wins. */
const liveStatusOf = (ms: Ms, own: Best | undefined, session: Holder | undefined): SectorStatus => {
  if (session === undefined || ms < session.ms) return 'sessionBest';
  return own === undefined || ms < own.ms ? 'personalBest' : 'none';
};

/**
 * The newest finished time per sector (spec 3.4): sectors 1 and 2 from the live timing once the current pass has
 * passed their end, else (and sector 3 always) the newest lap record's, judged as that record is. A time is older when
 * it belongs to an earlier pass than the newest one with a time: the lap just finished is not older until the current
 * pass has a sector of its own, and on a restarted pass every time before it is older, a live time the game still
 * shows from the abandoned attempt included. A time of the current pass on an invalid lap ranks `none`. `live` is absent for a car out of the race: its record times stand.
 */
export function newestSectorsOf(
  row: Omit<LapBoardRow, 'deltaToReference'>,
  live: LivePass | undefined,
  bests: CarBests,
  session: ReturnType<typeof sessionBestsOf>,
): Pick<LapBoardRow, 'newestSectorsMs' | 'newestSectorStatus' | 'newestSectorOlder'> {
  const passHasTime = live !== undefined && (live.sector > 1 || live.restarted);
  const newest: Newest[] = SECTORS.map((i) => ({ ms: row.lastSectorsMs[i], status: row.lastSectorStatus[i], older: passHasTime && row.lastSectorsMs[i].known }));
  if (live !== undefined) {
    for (const i of [0, 1] as const) {
      const ms = i === 0 ? live.sector1TimeMs : live.sector2TimeMs;
      const own = live.sector > i + 1;
      // 0 is the game's "no time yet" (C3); a time the pass has not reached is the abandoned attempt's, on a restart only
      if (ms <= 0 || (!own && !live.restarted)) continue;
      newest[i] = { ms: known(ms, live.at), status: own && live.invalid ? 'none' : liveStatusOf(ms, bests.sectors[i], session.sectors[i]), older: !own };
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
