import type { FuelState, UnknownReason } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { knownPart } from '../../kit/grid/grid.ts';
import { formatKgPerLap, formatKgUnit, formatLaps, formatSignedLaps } from '../../kit/values/format.ts';
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

/** The fuel rows in display order: margin, lasts, to go, burn, save target, the game's figure. */
export function fuelRows(fuel: FuelState): FuelRow[] {
  // The laps are the figure that decides; the kg in brackets is added when known (laps known and kg unknown shows the laps alone).
  const lasts = fuel.lapsOfFuel.known
    ? { text: fuel.kg.known ? text.lasts(formatLaps(fuel.lapsOfFuel.value), formatKgUnit(fuel.kg.value)) : formatLaps(fuel.lapsOfFuel.value) }
    : knownPart(fuel.lapsOfFuel, formatLaps);
  const role = marginRole(fuel.marginLaps);
  return [
    { key: 'margin', label: text.labels.margin, ...knownPart(fuel.marginLaps, formatSignedLaps), role, bold: true },
    { key: 'lasts', label: text.labels.lasts, ...lasts },
    { key: 'toGo', label: text.labels.toGo, ...knownPart(fuel.lapsLeft, formatLaps) },
    { key: 'burn', label: text.labels.burn, ...knownPart(fuel.burnKgPerLap, formatKgPerLap) },
    { key: 'save', label: text.labels.save, ...knownPart(fuel.saveTargetKgPerLap, formatKgPerLap) },
    {
      key: 'game',
      label: text.labels.game,
      ...knownPart(fuel.gameRemainingLaps, (n) => `${formatSignedLaps(n)} ${text.gameSuffix}`),
      dim: true,
    },
  ];
}
