// Pure view of an ERS state for the ers-budget display: formatted texts, the bar input and the reasons of empty cells.
import { formatJoules, formatMJ, formatSignedMJ } from '../../kit/values/format.ts';
import type { ErsState, Known, Joules, UnknownReason } from '@pitwall/domain';
import * as text from './text.ts';

/** Bar width in character cells per size mode. */
export const BAR_COLS = { full: 18, compact: 6 } as const;

export type ErsView = {
  /** Input of the kit Bar (joules); `limit` is the attack level. */
  bar: { value: Known<Joules>; min: 0; max: Joules; limit: Joules };
  store: string;
  level: string;
  flow: string;
  deployed: string;
  deployLimit: string;
  harvested: string;
  trend: string;
  attack: string;
  attackReady: boolean;
  /** Between the trend and the attack; empty unless both are shown. */
  trendJoint: string;
  reasons: Record<'store' | 'flow' | 'deployed' | 'harvested' | 'trend', UnknownReason | undefined>;
};

const reasonOf = (k: Known<unknown>): UnknownReason | undefined => (k.known ? undefined : k.reason);
const joules = (k: Known<number>): string => (k.known ? formatJoules(k.value) : '');

const trendText = (k: Known<number>): string => (k.known ? `${formatSignedMJ(k.value)} ${text.perLap}` : '');

function attackText(a: ErsState['attack']): string {
  if (!a.known) return '';
  return a.value.ready ? text.attackReady : text.attackIn(a.value.inLaps);
}

/** What the display prints for an ERS state; the deploy mode is deliberately absent. */
export function ersView(s: ErsState): ErsView {
  const flow = s.flow.known ? (s.flow.value === 'deploying' ? text.deploying : s.flow.value === 'harvesting' ? text.harvesting : '') : '';
  const trend = trendText(s.storeTrendJPerLap);
  const attack = attackText(s.attack);
  return {
    bar: { value: s.storeJ, min: 0, max: s.capacityJ, limit: s.attackLevelJ },
    store: joules(s.storeJ),
    level: formatJoules(s.attackLevelJ),
    flow,
    deployed: joules(s.deployedThisLapJ),
    deployLimit: formatMJ(s.deployLimitJ),
    harvested: joules(s.harvestedThisLapJ),
    trend,
    attack,
    attackReady: s.attack.known && s.attack.value.ready,
    trendJoint: trend !== '' && attack !== '' ? text.joint : '',
    reasons: {
      store: reasonOf(s.storeJ),
      flow: reasonOf(s.flow),
      deployed: reasonOf(s.deployedThisLapJ),
      harvested: reasonOf(s.harvestedThisLapJ),
      trend: reasonOf(s.storeTrendJPerLap),
    },
  };
}
