// The priors entries of `race-interaction` (C62a, SP4.3a spec 5.4): per configured difficulty band the pass curve's
// level and slope over the sources' stints' following episodes. A source belongs to the band of its session's AI
// difficulty; a band's entries fit the episodes of its race sources pooled, whose follower is the source stint's car on
// the stint's laps minus its excluded ones, from the config's default curve with its shrinkage (C43: the calculator's
// fit). An override replaces the aggregate; each entry's fallback is the config's default.
import { known, unknown, type EstimateSource, type Known, type PassCurve } from '@pitwall/domain';
import { definePriors, type FallbackCtx, type PriorDecl, type PriorsCtx, type StoredSource } from '@pitwall/engine/readers';
import { DRIVER_NOISE_CONFIG } from '../driver-noise/config.ts';
import { bandIndexOf, configOf, DEFAULT_SOURCE, defaultCurve, parseBands } from './bands.ts';
import { RACE_INTERACTION_CONFIG } from './config.ts';
import { episodesOf, type FollowingEpisode } from './episodes.ts';
import { fitPassCurve } from './fit.ts';

/** The priors key of band `band`'s pass-curve level. */
export const passLevelKey = (band: number): string => `raceInteraction.passLevel.b${band}`;
/** The priors key of band `band`'s pass-curve slope. */
export const passSlopeKey = (band: number): string => `raceInteraction.passSlope.b${band}`;

/** The following episodes of a source: its stint's car following, on the stint's laps minus its excluded ones. */
function sourceEpisodes(source: StoredSource, ctx: Pick<PriorsCtx, 'config'>): FollowingEpisode[] {
  if (source.phase.kind !== 'race' || !source.track.known) return [];
  const { stint } = source;
  const excluded = new Set(source.source.excludedLaps);
  const stintLap = (car: number, lap: number): boolean => car === stint.carId && lap >= stint.firstLap && lap <= stint.lastLap && !excluded.has(lap);
  // free air by the shared rule with driver-noise's gap (C43)
  const freeAirGapMs = DRIVER_NOISE_CONFIG.read(ctx).freeAirGapMs;
  return episodesOf({ history: source.projection }, source.track.value, configOf(ctx.config), freeAirGapMs, stintLap);
}

/** The pooled episodes of the sources in band `band` (their session's `aiDifficulty`), in the sources' order. */
function bandEpisodes(sources: readonly StoredSource[], band: number, ctx: Pick<PriorsCtx, 'config'>): FollowingEpisode[] {
  const bands = parseBands(configOf(ctx.config).difficultyBands);
  return sources.flatMap((source) =>
    source.aiDifficulty.known && bandIndexOf(bands, source.aiDifficulty.value) === band ? sourceEpisodes(source, ctx) : [],
  );
}

/** The band's pooled curve, or unknown without an episode. */
function bandCurve(sources: readonly StoredSource[], band: number, ctx: PriorsCtx): Known<PassCurve> {
  const config = configOf(ctx.config);
  const episodes = bandEpisodes(sources, band, ctx);
  return episodes.length === 0 ? unknown('insufficientData') : known(fitPassCurve(episodes, defaultCurve(config), config.shrinkEpisodes), 0);
}

/** An entry of band `band`: the curve's `part` (level, or slope per ms). */
const curveEntry = (band: number, part: 'level' | 'slopePerMs', key: string, range: readonly [number, number]): PriorDecl => ({
  version: 1,
  range,
  aggregate: (sources, ctx): Known<number> => {
    const override = ctx.overrides[key];
    if (override !== undefined) return known(override, 0);
    const curve = bandCurve(sources, band, ctx);
    return curve.known ? known(curve.value[part], curve.at) : curve;
  },
  /** The episodes the band's fit rests on. */
  samples: (sources, ctx) => bandEpisodes(sources, band, ctx).length,
  /** The source's own value minus the set's. */
  residual: (source, set): Known<number> => {
    const own = source[key];
    const pooled = set[key];
    if (own?.known !== true || pooled?.known !== true) return unknown('insufficientData');
    return known(own.value - pooled.value, Math.max(own.at, pooled.at));
  },
  fallback: (ctx: FallbackCtx): { value: Known<number>; source: EstimateSource } => ({
    value: known(defaultCurve(configOf(ctx.config))[part], 0),
    source: DEFAULT_SOURCE,
  }),
});

const BANDS = parseBands(RACE_INTERACTION_CONFIG.defaults.difficultyBands);

export const RACE_INTERACTION_PRIORS = definePriors('race-interaction', {
  entries: Object.fromEntries(
    BANDS.flatMap((_, band) => [
      [passLevelKey(band), curveEntry(band, 'level', passLevelKey(band), [-20, 20])],
      [passSlopeKey(band), curveEntry(band, 'slopePerMs', passSlopeKey(band), [-1, 1])],
    ]),
  ),
  /** A race stint whose car follows in at least `candidateEpisodes` episodes. */
  candidate: (source, ctx) => {
    return sourceEpisodes(source, ctx).length >= configOf(ctx.config).candidateEpisodes;
  },
});
