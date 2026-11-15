// "Can a car pass" (SP4.3c O13, C43): the one pass curve, the model `fit.ts` fits. `race-forecast` calls it at every
// braking zone of its simulation and `battle` at the current gap, so the two agree for the same delta and gap.
import type { PassCurve, RaceInteraction } from '@pitwall/domain';

/** What the chance depends on besides the delta and the gap. */
export type PassContext = {
  /** The session's curve (`sessionCurve`). */
  curve: PassCurve;
  /** The one wet rule's verdict (`track-wetness`). */
  wet: boolean;
  /** DRS is open to the follower (race control has it on; in the simulator, the zone follows a DRS zone it was in range at). */
  drs: boolean;
  /** The one DRS range (`drsRangeMs`): the DRS term counts at a gap of at most this. */
  drsRangeMs: number;
};

/**
 * The chance of a pass at one braking zone of a car `deltaMs` a lap faster than the car ahead, `gapMs` behind it:
 * cap · σ(level + slopePerMs · deltaMs + drsFactor · [DRS within range]), × wetFactor when wet; 0 without an advantage.
 */
export function passChance(deltaMs: number, gapMs: number, ctx: PassContext): number {
  if (deltaMs <= 0) return 0;
  const { curve } = ctx;
  const eta = curve.level + curve.slopePerMs * deltaMs + (ctx.drs && gapMs <= ctx.drsRangeMs ? curve.drsFactor : 0);
  return ((ctx.wet ? curve.wetFactor : 1) * curve.cap) / (1 + Math.exp(-eta));
}

/** The session's pass curve: its band's, else the first band's; none without a band (none passes). */
export function sessionCurve(interaction: RaceInteraction): PassCurve | undefined {
  const { bands, band } = interaction;
  return (band.known ? bands[band.value]?.curve : undefined) ?? bands[0]?.curve;
}
