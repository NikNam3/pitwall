// Builders and cases shared by the calibration-panel gallery and its tests (test-phase file: the implementer does not edit
// it). The sample is the approved mockup's (docs/design/2026-11-06-sp4.1a/calibration-panel.html, gen.mjs): Silverstone
// (track 7), a league weekend on 06 Nov 2026, our cars KUH (car 0, the feed's player car) and LIN (car 1). The race runs
// on the set `league`, the preselection. `league` holds three medium stints of the league race (15 Oct) and its FP2
// (14 Oct), and one soft stint of that FP2 that is `missing`; its hard DEG/LAP has an override (0.045 s, 45 ms).
import type {
  CalibrationActiveValue, CalibrationCandidatesValue, CalibrationSet, CalibrationSetsValue, CalibrationSource,
  CalibrationValuesValue, FittedSource, Known, LapUse, Ms, PriorsEntries, SkippedSource, VisualCompound,
} from '@pitwall/domain';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';

/** Stored values carry no race-clock time of their own: the bridge's store writes them `at` 0. */
const k = <T>(value: T): Known<T> => known(value, toSessionTime(0));

export const SILVERSTONE = 7;
export const MONZA = 11;
export const SPA = 10;
export const KUH = carId(0);
export const LIN = carId(1);

/**
 * `calibration.candidates` with the newest stored session's track: the field the panel needs without a running session
 * (requested of the supervisor, `CalibrationCandidatesValue.newestTrackId`, report of Task 15). The intersection stays
 * valid once the domain type has the field.
 */
export type CandidatesValue = CalibrationCandidatesValue & { newestTrackId: number | null };

/** What the panel's four data entries get. */
export type PanelData = {
  sets: CalibrationSetsValue;
  values: CalibrationValuesValue;
  candidates: CandidatesValue;
  active: CalibrationActiveValue;
};

/** A source: a stint of a stored session, named by its session's key, its car and its first lap (spec 3.1). */
export const source = (sessionUid: string, weekendId: string, car: typeof KUH, firstLap: number, excludedLaps: number[] = []): CalibrationSource => ({
  sessionUid, weekendId, feedCar: KUH, car, firstLap, excludedLaps,
});

/** The stored sessions of the sample. */
const RACE = { uid: 'race-1015', weekend: 'league-r7', date: '2026-10-15T19:02:00Z' };
const FP2 = { uid: 'fp2-1014', weekend: 'league-r7', date: '2026-10-14T19:00:00Z' };
const FP1 = { uid: 'fp1-1106', weekend: 'league-r8', date: '2026-11-06T18:00:00Z' };
const TEST = { uid: 'test-0902', weekend: 'pre-season', date: '2026-09-02T17:30:00Z' };

/** Priors keys (declared by the units' `priors.ts`): degradation's per compound, tyre-life's, pit-loss's per condition. */
export const key = {
  offset: (c: VisualCompound) => `degradation.alphaOffsetMs.${c}`,
  deg: (c: VisualCompound) => `degradation.nuMsPerLap.${c}`,
  sd: (c: VisualCompound) => `degradation.nuSdMs.${c}`,
  wear: (c: VisualCompound, corner: 'fl' | 'fr' | 'rl' | 'rr') => `tyreLife.wearPerLapPct.${c}.${corner}`,
  wearLimit: 'tyreLife.wearLimitPct',
  ageLossLimit: 'tyreLife.ageLossLimitMs',
  pit: (condition: 'green' | 'vsc' | 'sc') => `pitLoss.ms.${condition}`,
} as const;

/** A lap of a source's lap list: `used`, never a pace lap (`{ excluded }`), or excluded by the user. */
type LapSpec = { lap: number; ms: number; use: LapUse; excluded?: boolean };
const lapList = (laps: LapSpec[]): FittedSource['lapList'] =>
  laps.map((l) => ({ lapNumber: l.lap, lapTimeMs: k<Ms>(l.ms), excluded: l.excluded === true, use: k(l.use) }));
/** Laps `first`..`last`, every one used at `ms`, except the ones given. */
const laps = (first: number, last: number, ms: number, except: LapSpec[] = []): FittedSource['lapList'] =>
  lapList(Array.from({ length: last - first + 1 }, (_, i) => first + i).map((lap) => except.find((e) => e.lap === lap) ?? { lap, ms: ms + 37 * (lap % 5), use: 'used' }));

/** A fitted source of compound `c` with its own DEG/LAP (`degMs`) and DRIFT (`driftSd`); `driftSd` undefined: none. */
function fitted(src: CalibrationSource, date: string, c: VisualCompound, list: FittedSource['lapList'], usedLaps: number, degMs: number, driftSd: number | undefined): FittedSource {
  return {
    source: src, sessionDate: date, compound: c, laps: list.length, usedLaps, lapList: list,
    entries: { [key.deg(c)]: k(degMs), [key.sd(c)]: k(6) },
    residuals: { [key.deg(c)]: driftSd === undefined ? unknown('notApplicable') : k(driftSd) },
  };
}

/** The opened source of the mockup: race 15 Oct, KUH, medium, L01–22; lap 1, the VSC laps 9 and 10 and the in-lap 22
 *  are never pace laps; the user excluded lap 14. */
export const raceKuh = source(RACE.uid, RACE.weekend, KUH, 1, [14]);
export const raceKuhLaps = laps(1, 22, 91_540, [
  { lap: 1, ms: 97_880, use: { excluded: 'notForPace' } },
  { lap: 9, ms: 112_400, use: { excluded: 'neutralised' } },
  { lap: 10, ms: 112_700, use: { excluded: 'neutralised' } },
  { lap: 14, ms: 93_120, use: 'used', excluded: true },
  { lap: 22, ms: 98_510, use: { excluded: 'inLap' } },
]);
export const raceLin = source(RACE.uid, RACE.weekend, LIN, 1);
export const fp2Kuh = source(FP2.uid, FP2.weekend, KUH, 6);
export const fp2LinSoft = source(FP2.uid, FP2.weekend, LIN, 3);
export const fp1Kuh = source(FP1.uid, FP1.weekend, KUH, 4);
export const fp1LinHard = source(FP1.uid, FP1.weekend, LIN, 3);
export const testKuh = source(TEST.uid, TEST.weekend, KUH, 2);

/** A source the store could not read: `missing` (its stint is gone) or `stale` (its session awaits a rebuild). */
export const skipped = (src: CalibrationSource, why: SkippedSource['skipped']): SkippedSource => ({
  source: src, skipped: why, sessionDate: k(FP2.date), compound: k('soft'),
});

export const leagueFits = (softWhy: SkippedSource['skipped'] = 'missing') => [
  fitted(raceKuh, RACE.date, 'medium', raceKuhLaps, 17, 54, 0.4),
  fitted(raceLin, RACE.date, 'medium', laps(1, 17, 91_800), 15, 47, -0.6),
  fitted(fp2Kuh, FP2.date, 'medium', laps(6, 17, 92_100), 10, 61, 1.1),
  skipped(fp2LinSoft, softWhy),
];

/** `league`'s entries: medium from its three sources; soft (its only source missing) and hard (none) uncovered, except
 *  hard's DEG/LAP, which the override sets; green and VSC from the league race's stops, SC uncovered. */
export const leagueEntries: PriorsEntries = {
  [key.offset('soft')]: unknown('insufficientData'), [key.deg('soft')]: unknown('insufficientData'), [key.sd('soft')]: unknown('insufficientData'),
  [key.offset('medium')]: k(0), [key.deg('medium')]: k(52), [key.sd('medium')]: k(6),
  [key.offset('hard')]: unknown('insufficientData'), [key.deg('hard')]: k(45), [key.sd('hard')]: unknown('insufficientData'),
  [key.wear('medium', 'fl')]: k(2.4), [key.wear('medium', 'fr')]: k(2.2), [key.wear('medium', 'rl')]: k(1.9), [key.wear('medium', 'rr')]: k(2.0),
  [key.wear('soft', 'fl')]: unknown('insufficientData'), [key.wear('soft', 'fr')]: unknown('insufficientData'),
  [key.wear('soft', 'rl')]: unknown('insufficientData'), [key.wear('soft', 'rr')]: unknown('insufficientData'),
  [key.wear('hard', 'fl')]: unknown('insufficientData'), [key.wear('hard', 'fr')]: unknown('insufficientData'),
  [key.wear('hard', 'rl')]: unknown('insufficientData'), [key.wear('hard', 'rr')]: unknown('insufficientData'),
  [key.wearLimit]: unknown('notApplicable'), [key.ageLossLimit]: unknown('notApplicable'),
  [key.pit('green')]: k(20_400), [key.pit('vsc')]: k(13_400), [key.pit('sc')]: unknown('insufficientData'),
};

const set = (id: string, trackId: number, name: string, createdAt: string, sources: CalibrationSource[], overrides: Record<string, number> = {}, lastUsedAt?: string): CalibrationSet => ({
  id, trackId, name, createdAt, sources, overrides, ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
});

/** The sets in the bridge's order (track, then `createdAt`, then id). */
export const SETS: CalibrationSet[] = [
  set('pre-season', SILVERSTONE, 'pre-season', '2026-09-02T17:40:00Z', [testKuh], {}, '2026-09-02T18:00:00Z'),
  set('league', SILVERSTONE, 'league', '2026-09-28T10:00:00Z', [raceKuh, raceLin, fp2Kuh, fp2LinSoft], { [key.deg('hard')]: 45 }, '2026-10-15T19:00:00Z'),
  set('after-floor-upgrade', SILVERSTONE, 'after-floor-upgrade', '2026-11-06T18:40:00Z', [fp1Kuh, fp1LinHard]),
  set('monza-test', MONZA, 'monza-test', '2026-08-20T12:00:00Z', []),
];

export const values = (softWhy: SkippedSource['skipped'] = 'missing'): CalibrationValuesValue => ({
  bySet: {
    'pre-season': { entries: { [key.deg('medium')]: k(58) }, fits: [fitted(testKuh, TEST.date, 'medium', laps(2, 14, 92_400), 12, 58, 0)] },
    league: { entries: leagueEntries, fits: leagueFits(softWhy) },
    'after-floor-upgrade': {
      entries: { [key.deg('medium')]: k(49), [key.deg('hard')]: k(36) },
      fits: [fitted(fp1Kuh, FP1.date, 'medium', laps(4, 15, 91_300), 11, 49, 0), fitted(fp1LinHard, FP1.date, 'hard', laps(3, 13, 91_900), 9, 36, 0)],
    },
    'monza-test': { entries: {}, fits: [] },
  },
});

/** The suggestions on Silverstone: this weekend's two FP1 stints (none of them in `league`), this weekend first. */
export const suggestions: FittedSource[] = [
  fitted(fp1Kuh, FP1.date, 'medium', laps(4, 15, 91_300), 11, 49, undefined),
  fitted(fp1LinHard, FP1.date, 'hard', laps(3, 13, 91_900), 9, 36, undefined),
];

export const candidates = (newestTrackId: number | null = SILVERSTONE): CandidatesValue => ({
  byTrack: { [SILVERSTONE]: suggestions, [MONZA]: [] },
  newestTrackId,
});

/** `calibration.active` of a running race on `setId` (`null`: `defaults`). */
export const running = (setId: string | null, trackId = SILVERSTONE): CalibrationActiveValue =>
  known({ sessionUid: 'race-1106', trackId, setId, setName: setId ?? 'defaults', snapshot: setId === null ? null : 'f3a9c1', picked: false }, toSessionTime(1_380_000));

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup's main figure (first case: the screenshot baseline per size, Task 18): the race runs on `league`, the
  // preselection; four sources, one missing; two suggestions; the hard DEG/LAP overridden.
  activeLeague: { sets: { sets: SETS }, values: values(), candidates: candidates(), active: running('league') },
  // No session loaded: the panel works from storage, on the newest stored session's track (Silverstone).
  noSession: { sets: { sets: SETS }, values: values(), candidates: candidates(), active: unknown('notApplicable') },
  // The soft source's session awaits a rebuild (C61): `stale` instead of `missing`.
  staleSource: { sets: { sets: SETS }, values: values('stale'), candidates: candidates(), active: running('league') },
  // The race runs on `defaults`: the panel shows the track's sets, none of them active.
  defaultsChosen: { sets: { sets: SETS }, values: values(), candidates: candidates(), active: running(null) },
  // A track without a set or a suggestion (Spa).
  noSet: { sets: { sets: SETS }, values: values(), candidates: candidates(), active: running(null, SPA) },
} satisfies Record<string, PanelData>;

/** The gallery's fit sizes: each mode's minimum (README: compact 36×7, full 76×29 with no source open) plus a size just
 *  inside each mode. */
export const fit = [
  { mode: 'compact', cols: 36, rows: 7 },
  { mode: 'compact', cols: 75, rows: 28 },
  { mode: 'full', cols: 76, rows: 29 },
  { mode: 'full', cols: 100, rows: 40 },
];
