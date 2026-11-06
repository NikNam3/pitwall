// The priors entries of `pit-loss` (spec 3.2, 4.3): per condition the median loss over every counted stop (`used`: no
// penalty served, R12) of the sessions that give the set a source, each session counted once; an override replaces it.
import { currentLaps, known, unknown, type Known, type PitCondition } from '@pitwall/domain';
import { definePriors, type PriorDecl, type PriorsCtx, type StoredSource } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PIT_LOSS_CONFIG } from './config.ts';
import { median, sessionStops, type PitLossOptions } from './loss.ts';

/** The conditions a stop is made under: its record's flag. */
export const PIT_CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

/** The priors key of a condition's pit loss. */
export const pitLossKey = (condition: PitCondition): string => `pitLoss.ms.${condition}`;

/** The options a source session's stops are judged with: the effective configs (C47) and the session's weekend phase. */
const optionsOf = (source: StoredSource, ctx: PriorsCtx): PitLossOptions => ({
  ...PIT_LOSS_CONFIG.defaults,
  ...ctx.config[PIT_LOSS_CONFIG.key],
  classes: { isRace: source.phase.kind === 'race', ...LAP_CLASSES_CONFIG.defaults, ...ctx.config[LAP_CLASSES_CONFIG.key] },
});

/** The entry of one condition. */
const lossEntry = (condition: PitCondition): PriorDecl => {
  const key = pitLossKey(condition);
  return {
    version: 1,
    range: [5000, 60000],
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
