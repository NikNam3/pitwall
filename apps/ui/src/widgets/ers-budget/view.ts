// Pure view of an ERS state for the ers-budget display: formatted texts, the bar input and the reasons of empty cells.
import { fixed, formatJoules } from '../../kit/values/format.ts';
import type { ErsState, Known, Joules, UnknownReason } from '@pitwall/domain';
import * as text from './text.ts';

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
  reasons: Record<'store' | 'flow' | 'deployed' | 'harvested' | 'trend', UnknownReason | undefined>;
};

const MINUS = '−';
const reasonOf = (k: Known<unknown>): UnknownReason | undefined => (k.known ? undefined : k.reason);
const joules = (k: Known<number>): string => (k.known ? formatJoules(k.value) : '');

function formatTrend(k: Known<number>): string {
  if (!k.known) return '';
  const mj = fixed(Math.abs(k.value) / 1e6, 1);
  const sign = k.value > 0 && mj !== '0.0' ? '+' : k.value < 0 && mj !== '0.0' ? MINUS : '';
  return `${sign}${mj} ${text.perLap}`;
}

function attackText(s: ErsState): { attack: string; ready: boolean } {
  if (!s.storeJ.known) return { attack: '', ready: false };
  if (s.storeJ.value >= s.attackLevelJ) return { attack: text.attackReady, ready: true };
  if (s.storeTrendJPerLap.known && s.storeTrendJPerLap.value > 0 && s.lapsToAttackLevel.known) {
    return { attack: text.attackIn(Math.max(1, Math.ceil(s.lapsToAttackLevel.value))), ready: false };
  }
  return { attack: '', ready: false };
}

/** What the display prints for an ERS state; the deploy mode is deliberately absent. */
export function ersView(s: ErsState): ErsView {
  const flow = s.flow.known ? (s.flow.value === 'deploying' ? text.deploying : s.flow.value === 'harvesting' ? text.harvesting : '') : '';
  const { attack, ready } = attackText(s);
  return {
    bar: { value: s.storeJ, min: 0, max: s.capacityJ, limit: s.attackLevelJ },
    store: joules(s.storeJ),
    level: formatJoules(s.attackLevelJ),
    flow,
    deployed: joules(s.deployedThisLapJ),
    deployLimit: fixed(s.deployLimitJ / 1e6, 1),
    harvested: joules(s.harvestedThisLapJ),
    trend: formatTrend(s.storeTrendJPerLap),
    attack,
    attackReady: ready,
    reasons: {
      store: reasonOf(s.storeJ),
      flow: reasonOf(s.flow),
      deployed: reasonOf(s.deployedThisLapJ),
      harvested: reasonOf(s.harvestedThisLapJ),
      trend: reasonOf(s.storeTrendJPerLap),
    },
  };
}
