import type { FuelState, Known, UnknownReason } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { formatKg, formatKgPerLap, formatLaps, formatSignedLaps } from '../../kit/values/format.ts';
import { marginRole } from './emphasis.ts';
import * as text from './text.ts';

/** One line of the fuel panel; an unknown figure has empty text and its reason. */
export type FuelRow = {
  key: keyof typeof text.labels;
  label: string;
  text: string;
  reason?: UnknownReason;
  role?: Role | undefined;
  bold?: boolean;
  dim?: boolean;
};

const cell = (value: Known<number>, format: (n: number) => string): { text: string; reason?: UnknownReason } =>
  value.known ? { text: format(value.value) } : { text: '', reason: value.reason };

/** The fuel rows in display order: margin, lasts, to go, burn, save target, the game's figure. */
export function fuelRows(fuel: FuelState): FuelRow[] {
  const lasts = !fuel.lapsOfFuel.known
    ? cell(fuel.lapsOfFuel, formatLaps)
    : !fuel.kg.known
      ? cell(fuel.kg, formatKg)
      : { text: `${formatLaps(fuel.lapsOfFuel.value)} (${formatKg(fuel.kg.value)} kg)` };
  const role = marginRole(fuel.marginLaps);
  return [
    { key: 'margin', label: text.labels.margin, ...cell(fuel.marginLaps, formatSignedLaps), role, bold: true },
    { key: 'lasts', label: text.labels.lasts, ...lasts },
    { key: 'toGo', label: text.labels.toGo, ...cell(fuel.lapsLeft, formatLaps) },
    { key: 'burn', label: text.labels.burn, ...cell(fuel.burnKgPerLap, formatKgPerLap) },
    { key: 'save', label: text.labels.save, ...cell(fuel.saveTargetKgPerLap, formatKgPerLap) },
    {
      key: 'game',
      label: text.labels.game,
      ...cell(fuel.gameRemainingLaps, (n) => `${formatSignedLaps(n)} ${text.gameSuffix}`),
      dim: true,
    },
  ];
}
