// `race-interaction` as of a frame (SP4.3a spec 5.4, 6.1): a pure function of the `AsOfView`.
//  - Per band the prior: the calibration's entries (`view.priors`, both level and slope), else the config's default
//    curve; the session's band (its AI difficulty) is then refined by this race's following episodes with shrinkage
//    (`fitPassCurve`), its source's `sessionShare` `n / (n + shrinkEpisodes)` for `n` episodes, its kind by the half rule
//    (spec 4.4, as `pit-loss`'s). The curve's DRS factor is fitted with it, its prior the config's `drsPassFactor`
//    (SP4.3b Task 10).
//  - The DRS pass factor's prior (`drsPassFactor`) and straight gain, the minimum gap and dirty air are the config's; the O14 values too, until the
//    pooled fit's check (Task 13), and `notApplicable` outside the race (the `weekend-phase` row, C14).
import { known, unknown, type EstimateSource, type Known, type PassCurve, type RaceInteraction } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';
import { DRIVER_NOISE_CONFIG } from '../driver-noise/config.ts';
import { RACE_INTERACTION_BEHAVIOUR, type RaceInteractionEffect } from './behaviour.ts';
import { bandIndexOf, configOf, DEFAULT_SOURCE, defaultCurve, parseBands } from './bands.ts';
import type { RaceInteractionConfig } from './config.ts';
import { episodesOf } from './episodes.ts';
import { fitPassCurve } from './fit.ts';
import { passLevelKey, passSlopeKey } from './priors.ts';

/** The weekend phase's row; a pending phase reads as the race's grid (C14). */
const phaseRow = (view: AsOfView): RaceInteractionEffect => {
  const kind = view.situation.weekendPhase.kind;
  return (kind === 'pending' ? undefined : RACE_INTERACTION_BEHAVIOUR['weekend-phase']?.[kind]) ?? {};
};

/** The session's AI difficulty, from the as-of view's fixed session values. */
const difficultyOf = (view: AsOfView): Known<number> => view.fixed.aiDifficulty;

/** Band `band`'s prior: the calibration's entries when it holds both, else the config's default. */
const priorOf = (view: AsOfView, band: number, config: RaceInteractionConfig): { curve: PassCurve; source: EstimateSource } => {
  const curve = defaultCurve(config);
  if (view.priors.known) {
    const { entries, setName, sources } = view.priors.value;
    const level = entries[passLevelKey(band)];
    const slope = entries[passSlopeKey(band)];
    if (level?.known === true && slope?.known === true) {
      return { curve: { ...curve, level: level.value, slopePerMs: slope.value }, source: { kind: 'calibration', setName, sources, sessionShare: 0, parts: 'calibration' } };
    }
  }
  return { curve, source: DEFAULT_SOURCE };
};

/** `n episodes`: `1 episode`, `3 episodes`. */
const episodesWord = (n: number): string => (n === 1 ? '1 episode' : `${n} episodes`);

/** The pass curves, DRS, the following gap and the O14 values, as of `view`'s frame. */
export function raceInteractionAsOf(view: AsOfView): RaceInteraction {
  const config = configOf(view.config);
  const bands = parseBands(config.difficultyBands);
  const applicable = phaseRow(view).notApplicable !== true;
  let band: Known<number> = unknown('notApplicable');
  if (applicable) {
    const difficulty = difficultyOf(view);
    const index = difficulty.known ? bandIndexOf(bands, difficulty.value) : -1;
    band = !difficulty.known ? difficulty : index < 0 ? unknown('notApplicable') : known(index, difficulty.at);
  }
  const freeAirGapMs = DRIVER_NOISE_CONFIG.read(view).freeAirGapMs;
  const episodes = band.known && view.track.known ? episodesOf({ history: view.history, situation: view.situation }, view.track.value, config, freeAirGapMs) : [];
  const passes = episodes.reduce((n, e) => n + e.zones.filter((z) => z.passed).length, 0);

  return {
    bands: bands.map((range, i) => {
      const prior = priorOf(view, i, config);
      if (!band.known || band.value !== i || episodes.length === 0) return { ...range, curve: prior.curve, source: prior.source, episodes: 0, passes: 0 };
      const n = episodes.length;
      const sessionShare = n / (n + config.shrinkEpisodes);
      const parts = `${episodesWord(n)} + ${prior.source.parts}`;
      const source: EstimateSource = sessionShare > 0.5 ? { kind: 'session', sessionShare, parts } : { ...prior.source, sessionShare, parts };
      return { ...range, curve: fitPassCurve(episodes, prior.curve, config.shrinkEpisodes), source, episodes: n, passes };
    }),
    band,
    drsPassFactor: config.drsPassFactor,
    drsStraightGainMs: config.drsStraightGainMs,
    minGapMs: config.minGapMs,
    heldLossMsPerLap: applicable ? known(config.heldLossMsPerLap, 0) : unknown('notApplicable'),
    rejoinPushBackMs: applicable ? known(config.rejoinPushBackMs, 0) : unknown('notApplicable'),
    dirtyAirMsPerLap: config.dirtyAirMsPerLap,
  };
}
