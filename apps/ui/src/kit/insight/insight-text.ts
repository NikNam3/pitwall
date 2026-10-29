// The words of an insight (spec 8.3): the bridge sends a kind and params, the UI formats them.
import type { Insight } from '@pitwall/domain';
import { insightText as words } from '../text.ts';
import { fixed, formatLaps } from '../values/format.ts';

type Params = Insight['params'];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const signed = (n: number, decimals: number): string => (n < 0 ? `${words.minus}${fixed(-n, decimals)}` : fixed(n, decimals));

/** `tyre.carcassC.FR` -> `FR carcass`, `brakesC.FR` -> `FR brake`, `engineC` -> `engine`; the unit follows the channel. */
function channelText(channel: string | undefined): { name: string; unit: string } {
  const [head, second, third] = (channel ?? '').split('.');
  const key = head === 'tyre' ? second : head;
  const label = (key !== undefined && key in words.channel ? words.channel[key as keyof typeof words.channel] : channel) ?? '';
  const corner = head === 'tyre' ? third : second;
  return { name: corner === undefined ? label : `${corner} ${label}`, unit: key === 'pressurePsi' ? ' psi' : ' °C' };
}

const valueText = (value: number | undefined, unit: string): string => (value === undefined ? '' : ` ${Math.round(value)}${unit}`);

/** Known kinds: the alarms of spec 5.6. */
const KINDS: Record<string, (params: Params) => string> = {
  bandOut: (p) => {
    const { name, unit } = channelText(str(p['channel']));
    const where = p['state'] === 'below' ? words.below : words.above;
    return `${name} ${where}${valueText(num(p['value']), unit)}`;
  },
  bandOutLap: (p) => `${channelText(str(p['channel'])).name} ${words.outOfBandLap}`,
  wearLimitNear: (p) => {
    const laps = num(p['lapsToLimit']);
    return words.wearLimitNear(str(p['corner']) ?? '', laps === undefined ? '' : formatLaps(laps));
  },
  fuelShort: (p) => {
    const margin = num(p['marginLaps']);
    return words.fuelShort(margin === undefined ? '' : `${signed(margin, 1)} laps`);
  },
  damageJump: (p) => {
    const delta = num(p['deltaPct']);
    return words.damageJump((str(p['parts']) ?? '').split(',').join(', '), delta === undefined ? '' : `+${Math.round(delta)} %`);
  },
  warningLast: (p) => words.warningLast(num(p['warnings']) ?? 0, num(p['before']) ?? 0),
  penaltyNew: (p) => {
    const ms = num(p['timeMs']);
    return ms === undefined ? words.penalty : `${words.penalty} +${Math.round(ms / 1000)} s`;
  },
};

/** The text of an insight; a kind without an entry is shown as `kind: key value, key value`. */
export function formatInsight(i: Insight): string {
  const known = KINDS[i.kind];
  if (known !== undefined) return known(i.params);
  const params = Object.entries(i.params).map(([k, v]) => `${k} ${v}`);
  return params.length === 0 ? i.kind : `${i.kind}: ${params.join(', ')}`;
}
