// Builders and cases shared by the stint-scatter gallery and its tests (test-phase file: the implementer does not edit
// it). Tests import the cases from here, never `gallery.ts` (C69). The sample follows the approved mockups
// (`docs/design/2026-10-30-sp4a-displays/4-longrun.html`, `docs/design/2026-11-06-sp4.1a/source-badge.html`):
// Silverstone, KUH on mediums from lap 1, basis wear; the three-stint case is LIN's soft, medium and hard stints.
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  ActualCompound, CompoundEstimate, EstimateSource, FitPoint, Known, LapUse, Ms, StintAnalysis, StintFit, StintLap, UnknownReason,
  VisualCompound,
} from '@pitwall/domain';

const at = toSessionTime(2_400_000);
export const k = <T>(value: T): Known<T> => known(value, at);

/** The actual compound of each visual one at the sample event. */
const ACTUAL: Partial<Record<VisualCompound, ActualCompound>> = { soft: 'C3', medium: 'C2', hard: 'C1' };

/** Excluded for the given reason. */
export const excluded = (reason: Exclude<LapUse, string>['excluded']): LapUse => ({ excluded: reason });

/** One lap: its fuel-corrected time `correctedMs` (the raw lap time 2.5 s slower), or an unknown corrected time. */
export const lap = (lapNumber: number, tyreAge: number, correctedMs: Ms | UnknownReason, use: LapUse = 'used'): StintLap => ({
  lapNumber,
  tyreAge,
  lapTimeMs: (typeof correctedMs === 'number' ? correctedMs : 91_000) + 2_500,
  correctedMs: typeof correctedMs === 'number' ? k(correctedMs) : unknown(correctedMs),
  use,
});

/** The fit line from tyre age 1 to `toAge`: `baseMs + nu · age` with a band of `sdMs`. */
export const fitLine = (baseMs: Ms, nu: number, sdMs: Ms, toAge: number): FitPoint[] =>
  Array.from({ length: toAge }, (_, i) => ({ tyreAge: i + 1, ms: Math.round(baseMs + nu * (i + 1)), sdMs }));

export const sessionSource = (parts: string): EstimateSource => ({ kind: 'session', sessionShare: 0.88, parts });
export const calibrationSource = (parts: string): EstimateSource => ({ kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0.31, parts });
export const defaultSource = (note: string): EstimateSource => ({ kind: 'default', note, sessionShare: 0, parts: 'track default' });

type StintOver = Partial<Omit<StintFit, 'laps' | 'fitLine'>> & { laps: StintLap[]; fitLine: Known<FitPoint[]> };

/** A stint on `visual` from `firstLap` to `lastLap`; the rest defaults to a fuel-corrected wear-basis session fit. */
export const stint = (n: number, visual: VisualCompound, firstLap: number, lastLap: number, over: StintOver): StintFit => ({
  stint: n,
  firstLap,
  lastLap,
  actual: ACTUAL[visual] ?? 'unknown',
  visual,
  basePaceMs: k(90_600),
  nuMsPerLap: k(55),
  nuSdMs: k(9),
  basis: 'wear',
  fuelCorrected: true,
  source: sessionSource(`${over.laps.length} laps + calibration`),
  ...over,
});

/** A compound's estimate pooled over our cars' stints on it (spec 5.1): the prior's offset, `ν` and sd, our used laps on it. */
export const compound = (
  visual: VisualCompound,
  alphaOffsetMs: Known<Ms>,
  nuMsPerLap: number,
  nuSdMs: number,
  laps: number,
  source: EstimateSource,
): CompoundEstimate => ({ actual: ACTUAL[visual] ?? 'unknown', visual, alphaOffsetMs, nuMsPerLap: k(nuMsPerLap), nuSdMs: k(nuSdMs), laps, source });

// ---- KUH: one medium stint from lap 1 (the approved full mockup) ----

/** KUH's medium laps by tyre age: the out lap (age 1), the in and out laps of a VSC (ages 9, 10) excluded; a slow lap at age 14 down-weighted. */
/** Used laps from tyre age `fromAge` on, one per corrected time (KUH's lap number is its tyre age). */
const usedFrom = (fromAge: number, times: Ms[]): StintLap[] => times.map((ms, i) => lap(fromAge + i, fromAge + i, ms));

export const kuhLaps: StintLap[] = [
  lap(1, 1, 93_100, excluded('outLap')),
  ...usedFrom(2, [90_980, 91_120, 91_100, 91_060, 91_250, 91_235, 91_320]),
  lap(9, 9, 93_400, excluded('neutralised')),
  lap(10, 10, 93_300, excluded('neutralised')),
  ...usedFrom(11, [91_555, 91_610, 91_520]),
  lap(14, 14, 91_900, 'downWeighted'),
  ...usedFrom(15, [91_690, 91_710, 91_925, 91_895, 91_975, 92_100, 91_990, 92_105, 92_155]),
];

export const kuhStint = stint(1, 'medium', 1, 23, {
  laps: kuhLaps,
  fitLine: k(fitLine(90_980, 55, 150, 23)),
  source: sessionSource('19 laps + league (3 sources), 88 % session'),
});

/**
 * KUH's compounds table as the approved mockup (`source-badge.html`): pooled over our two cars, KUH's mediums and LIN's
 * softs and hards; S and M from the session, H still the calibration's.
 */
export const kuhCompounds: CompoundEstimate[] = [
  compound('soft', k(0), 85, 18, 14, sessionSource('14 laps + track default')),
  compound('medium', k(412), 55, 9, 41, sessionSource('41 laps + league')),
  compound('hard', k(780), 41, 15, 8, calibrationSource('8 laps + league')),
];

// ---- LIN: three stints, soft, medium and hard (current); an excluded and a down-weighted lap in each closed stint ----

export const linStints: StintFit[] = [
  stint(1, 'soft', 1, 8, {
    basis: 'age',
    laps: [
      lap(1, 1, 92_900, excluded('notForPace')),
      ...[2, 3, 4, 5].map((age) => lap(age, age, 90_500 + 85 * age)),
      lap(6, 6, 91_600, 'downWeighted'),
      lap(7, 7, 91_100),
      lap(8, 8, 93_200, excluded('inLap')),
    ],
    fitLine: k(fitLine(90_500, 85, 180, 8)),
    source: sessionSource('6 laps + track default'),
  }),
  stint(2, 'medium', 9, 20, {
    basis: 'age',
    laps: [
      lap(9, 1, 93_000, excluded('outLap')),
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((age) => lap(8 + age, age, 90_900 + 55 * age)),
      lap(18, 10, 92_000, 'downWeighted'),
      lap(19, 11, 91_500),
      lap(20, 12, 93_600, excluded('inLap')),
    ],
    fitLine: k(fitLine(90_900, 55, 120, 12)),
    source: sessionSource('10 laps + league (3 sources), 88 % session'),
  }),
  stint(3, 'hard', 21, 28, {
    basis: 'age',
    laps: [
      lap(21, 1, 93_100, excluded('outLap')),
      ...[2, 3, 4, 5, 6, 7, 8].map((age) => lap(20 + age, age, 91_200 + 41 * age)),
    ],
    fitLine: k(fitLine(91_200, 41, 160, 8)),
    source: calibrationSource('league: your override 0.045 · + 7 laps this session (LIN), 31 % session'),
  }),
];

const softPrior = compound('soft', k(0), 85, 18, 6, sessionSource('6 laps (LIN, stint 1) + track default'));

/** The compounds table of the redrawn mockup: S and M from the session, H from the calibration. */
export const linCompounds: CompoundEstimate[] = [
  softPrior,
  compound('medium', k(412), 55, 9, 10, sessionSource('10 laps + league (3 sources), 88 % session')),
  compound('hard', k(780), 41, 15, 7, calibrationSource('league: your override 0.045 · + 7 laps this session (LIN), 31 % session')),
];

/** A compound with no stint of ours whose prior is the config default without a track file: LAPS 0, no offset. */
export const defaultCompound = compound(
  'inter',
  unknown('notApplicable'),
  60,
  60,
  0,
  defaultSource('degradation config default (pitwall estimate)'),
);

// ---- the cases (the gallery's, in its order; the first is the screenshot baseline) ----

export const cases = {
  // The approved mockups: KUH's one medium stint, three excluded laps (faint rings at the edge) and a down-weighted one;
  // the compounds table of `source-badge.html`, pooled over our two cars (S, M, H with LAPS 14, 41, 8).
  oneStint: { analysis: k({ stints: [kuhStint], compounds: kuhCompounds }) as StintAnalysis },
  // LIN's three stints: the earlier two grey, the current one white; each closed stint holds an excluded and a
  // down-weighted lap; the compounds table holds a session, a calibration and a default row.
  threeStints: { analysis: k({ stints: linStints, compounds: [...linCompounds, defaultCompound] }) as StintAnalysis },
  // The current stint's fit is not known yet (too few laps): its laps show, no line, the reason's mark.
  unknownFit: {
    analysis: k({
      stints: [stint(1, 'soft', 1, 3, { laps: [lap(1, 1, 92_900, excluded('outLap')), lap(2, 2, 90_700), lap(3, 3, 90_800)], fitLine: unknown('insufficientData') })],
      compounds: [softPrior],
    }) as StintAnalysis,
  },
  // A rival linked as the primary car: the analysis answers only our cars.
  rival: { analysis: unknown('notApplicable') as StintAnalysis },
} as const;
