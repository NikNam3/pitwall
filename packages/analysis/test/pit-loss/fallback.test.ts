// `pit-loss`'s declared fallbacks (SP4.1a fx3, ruling R35; C43, C62a, C62b): per condition the loss a run uses when
// its snapshot has none, with its default source, the one rule the calculator's blend and the calibration panel's `ᵈ`
// values both read. With no stop of the session the calculator's estimate is its default alone. No priors (C84).
import { unknown, known, type PitCondition } from '@pitwall/domain';
import type { EngineView, FallbackCtx, PriorDecl } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { engineView } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { pitLossCalculator } from '../../src/pit-loss/calculator.ts';
import { PIT_LOSS, PIT_LOSS_PRIORS, type PitLossOutput } from '../../src/pit-loss/index.ts';

const CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

const fallbackOf = (condition: PitCondition): NonNullable<PriorDecl['fallback']> => {
  const fallback = PIT_LOSS_PRIORS.entries[`pitLoss.ms.${condition}`]?.fallback;
  if (fallback === undefined) throw new Error(`pitLoss.ms.${condition} declares no fallback`);
  return fallback;
};

/** The calculator's estimates of a session without a stop and without priors, through its guarded view (C41). */
const estimates = (track: EngineView['track']): PitLossOutput['conditions'] =>
  (pitLossCalculator.compute(guardedView(engineView({ track, priors: unknown('notApplicable') }), pitLossCalculator.reads, { unit: PIT_LOSS })) as PitLossOutput)
    .conditions;

const track = zandvoortTrack();
const withoutGreen = { ...track, defaults: { ...track.defaults, pitLossMs: { ...track.defaults.pitLossMs, green: unknown('notReceived') } } };

const TRACKS: [string, EngineView['track']][] = [
  ['the track file holding the condition`s loss', known(track, 0)],
  ['a track file without the green loss', known(withoutGreen, 0)],
  ['no track file', unknown('notApplicable')],
];

describe('pit-loss fallback (R35)', () => {
  it.each(TRACKS)('the declared fallback equals the default the calculator uses (%s)', (_, trackOf) => {
    const out = estimates(trackOf);
    const ctx: FallbackCtx = { config: {}, track: trackOf };
    for (const condition of CONDITIONS) {
      const { lossMs, source } = out[condition];
      expect(out[condition].sessionStops).toBe(0);
      expect(fallbackOf(condition)(ctx)).toEqual({ value: lossMs, source });
    }
  });

  it('a key without a default declares no fallback', () => {
    // every condition's loss has a run-time default: the track file's (unknown without one), so none declares none
    const without = Object.entries(PIT_LOSS_PRIORS.entries).filter(([, decl]) => decl.fallback === undefined).map(([key]) => key);
    expect(without).toEqual([]);
  });
});
