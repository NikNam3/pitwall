// The words of an insight (spec 8.3): the bridge sends a kind and params, the UI formats them through the kit formatters.
import type { DamageParts, Insight } from '@pitwall/domain';
import { cornerNames, insightText as words } from '../text.ts';
import { formatCelsius, formatDeltaPct, formatLaps, formatPenaltyMs, formatPsi, formatSignedLaps } from '../values/format.ts';

type Params = Insight['params'];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A corner key as its name, `fr` -> `FR`; an unexpected key is shown upper-cased. */
const cornerName = (corner: string): string => cornerNames[corner.toLowerCase() as keyof typeof cornerNames] ?? corner.toUpperCase();

/** A damage part key in words, `floorPct` -> `floor`; an unexpected key is shown as sent. */
const partName = (part: string): string => (part in words.part ? words.part[part as keyof DamageParts] : part);

/** `tyre.carcassC.fr` -> `FR carcass`, `brakesC.fr` -> `FR brake`, `engineC` -> `engine`; the value formats by the channel's unit. */
function channelText(channel: string | undefined): { name: string; value: (v: number) => string } {
  const [head, second, third] = (channel ?? '').split('.');
  const key = head === 'tyre' ? second : head;
  const label = (key !== undefined && key in words.channel ? words.channel[key as keyof typeof words.channel] : channel) ?? '';
  const corner = head === 'tyre' ? third : second;
  return {
    name: corner === undefined ? label : `${cornerName(corner)} ${label}`,
    value: key === 'pressurePsi' ? (v) => `${formatPsi(v)} psi` : formatCelsius,
  };
}

/** Known kinds: the alarms of spec 5.6. */
const KINDS: Record<string, (params: Params) => string> = {
  bandOut: (p) => {
    const { name, value } = channelText(str(p['channel']));
    const where = p['state'] === 'below' ? words.below : words.above;
    const v = num(p['value']);
    return v === undefined ? `${name} ${where}` : `${name} ${where} ${value(v)}`;
  },
  bandOutLap: (p) => `${channelText(str(p['channel'])).name} ${words.outOfBandLap}`,
  wearLimitNear: (p) => {
    const laps = num(p['lapsToLimit']);
    return words.wearLimitNear(cornerName(str(p['corner']) ?? ''), laps === undefined ? '' : formatLaps(laps));
  },
  fuelShort: (p) => {
    const margin = num(p['marginLaps']);
    return words.fuelShort(margin === undefined ? '' : formatSignedLaps(margin));
  },
  damageJump: (p) => {
    const delta = num(p['deltaPct']);
    const parts = (str(p['parts']) ?? '').split(',').filter((k) => k !== '').map(partName);
    return words.damageJump(parts.join(', '), delta === undefined ? '' : formatDeltaPct(delta));
  },
  warningLast: (p) => words.warningLast(num(p['warnings']) ?? 0, num(p['before']) ?? 0),
  penaltyNew: (p) => {
    const ms = num(p['timeMs']);
    return ms === undefined ? words.penalty : `${words.penalty} ${formatPenaltyMs(ms)}`;
  },
};

/** The text of an insight; a kind without an entry is shown as `kind: key value, key value`. */
export function formatInsight(i: Insight): string {
  const known = KINDS[i.kind];
  if (known !== undefined) return known(i.params);
  const params = Object.entries(i.params).map(([k, v]) => `${k} ${v}`);
  return params.length === 0 ? i.kind : `${i.kind}: ${params.join(', ')}`;
}
