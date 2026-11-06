// The priors entries of `pit-loss` (spec 3.2, 4.3): per condition the median loss over every counted stop (`used`: no
// penalty served, R12) of the sessions that give the set a source, each session counted once; an override replaces it.
// Each entry's fallback is the track file's default (`pitLossFallback`), the prior the calculator blends with (C43).
import { currentLaps, known, unknown, type EstimateSource, type Known, type PitCondition } from '@pitwall/domain';
import { definePriors, type FallbackCtx, type PriorDecl, type PriorsCtx, type StoredSource } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { phaseRow } from './behaviour.ts';
import { PIT_LOSS_CONFIG } from './config.ts';
import { median, sessionStops, type PitLossOptions } from './loss.ts';

/** The conditions a stop is made under: its record's flag. */
export const PIT_CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

/** The priors key of a condition's pit loss. */
export const pitLossKey = (condition: PitCondition): string => `pitLoss.ms.${condition}`;

/** The source of an estimate that has neither a prior nor a counted stop: its value is unknown. */
const NO_ESTIMATE: EstimateSource = { kind: 'default', note: 'no calibration and no track default', sessionShare: 0, parts: 'no stops' };

/**
 * The loss of `condition` a run uses without a calibration entry, with its source: the track file's default (its note the
 * file's), else unknown (`NO_ESTIMATE`). The calculator's prior then (spec 4.3) and the calibration panel's `ᵈ` value.
 */
export const pitLossFallback =
  (condition: PitCondition) =>
  (ctx: FallbackCtx): { value: Known<number>; source: EstimateSource } => {
    const fileDefault = ctx.track.known ? ctx.track.value.defaults.pitLossMs[condition] : undefined;
    if (fileDefault?.known !== true) return { value: unknown('insufficientData'), source: NO_ESTIMATE };
    return {
      value: known(fileDefault.value.value, fileDefault.at),
      source: { kind: 'default', note: fileDefault.value.source, sessionShare: 0, parts: 'track default' },
    };
  };

/** The options a source session's stops are judged with: the effective configs (C47) and the session's weekend phase. */
const optionsOf = (source: StoredSource, ctx: PriorsCtx): PitLossOptions => ({
  ...PIT_LOSS_CONFIG.defaults,
  ...ctx.config[PIT_LOSS_CONFIG.key],
  classes: { isRace: phaseRow(source.phase.kind).isRace === true, ...LAP_CLASSES_CONFIG.defaults, ...ctx.config[LAP_CLASSES_CONFIG.key] },
});

/** The entry of one condition. */
const lossEntry = (condition: PitCondition): PriorDecl => {
  const key = pitLossKey(condition);
  return {
    version: 1,
    range: [5000, 60000],
    fallback: pitLossFallback(condition),
    aggregate: (sources, ctx): Known<number> => {
      const override = ctx.overrides[key];
      if (override !== undefined) return known(override, 0);
      // one source per session: its stops and laps are the session's, however many of its stints are sources
      const sessions = new Map<string, StoredSource>();
      for (const source of sources) {
        const id = `${source.source.weekendId}/${String(source.source.sessionUid)}`;
        if (!sessions.has(id)) sessions.set(id, source);
      }
      const losses: number[] = [];
      for (const source of sessions.values()) {
        for (const stop of sessionStops(source.pitStops, currentLaps(source.sessionLaps), optionsOf(source, ctx))) {
          if (stop.condition === condition && stop.use === 'used' && stop.lossMs.known) losses.push(stop.lossMs.value);
        }
      }
      return losses.length === 0 ? unknown('insufficientData') : known(Math.round(median(losses)), 0);
    },
    /** The source session's median minus the set's, in ms. */
    residual: (source, set): Known<number> => {
      const own = source[key];
      const pooled = set[key];
      if (own?.known !== true || pooled?.known !== true) return unknown('insufficientData');
      return known(own.value - pooled.value, Math.max(own.at, pooled.at));
    },
  };
};

export const PIT_LOSS_PRIORS = definePriors('pit-loss', {
  entries: Object.fromEntries(PIT_CONDITIONS.map((condition) => [pitLossKey(condition), lossEntry(condition)])),
});
