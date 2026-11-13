// Wording of the drivers panel (mockup docs/design/2026-11-12-sp4.3b/drivers-panel.html); text shared with the kit lives
// in kit/text.ts.
import type { GameSettings, TeamId } from '@pitwall/domain';

/** Section titles. */
export const seatsTitle = 'SEATS';
export const sessionsTitle = 'SESSIONS';
export const lobbyTitle = 'LOBBY';
export const configTitle = 'CONFIG';

/** The picker's two choices after the persons. */
export const pickNew = 'new';
export const pickNone = 'none';
export const pickerHover = 'the person who drives this seat';
export const nameHover = 'name of the new person: Enter saves, Esc cancels';

/** Headers of a person's entries, of the config table and of the compact mode. */
export const entryHeaders = { entry: 'ENTRY', value: 'VALUE', laps: 'LAPS', ses: 'SES', newest: 'NEWEST', ovr: 'OVR' } as const;
export const configHeaders = { unit: 'UNIT', key: 'KEY', value: 'VALUE' } as const;
export const compactHeaders = { ses: 'SES', laps: 'LAPS' } as const;

/** The labels of the profile entries the panel knows; another key shows as itself. */
export const entryLabels: Readonly<Record<string, string>> = {
  'driverNoise.sigmaMs': 'σ lap s',
  'driverNoise.rho': 'ρ',
  'driverNoise.mistakeRate': 'mistake/lap',
  'driverNoise.mistakeMedianMs': 'mistake s',
  'driverNoise.mistakeSigmaLog': 'mistake σlog',
  'driverNoise.wearRatePct.soft': 'wear S %/lap',
  'driverNoise.wearRatePct.medium': 'wear M %/lap',
  'driverNoise.wearRatePct.hard': 'wear H %/lap',
};
export const overrideHover = (value: string): string => `your override ${value}`;
export const overrideFieldHover = (label: string): string => `override of ${label}, empty clears it`;

/** A linked session's toggle: kept or excluded, and what a click does. */
export const sessionToggle = { kept: '[x]', excluded: '[ ]' } as const;
export const excludeHover = 'kept: a click leaves this session out of the profile';
export const includeHover = 'excluded by you: a click takes it into the profile again';

/** The lobby settings the panel shows, in order, with their labels and the words of their values. */
export const lobbyLabels = {
  safetyCar: 'safety car',
  redFlags: 'red flags',
  carDamage: 'car damage',
  carDamageRate: 'damage rate',
  tyreTemperature: 'tyre temp',
  recoveryMode: 'recovery',
} as const satisfies Partial<Record<keyof GameSettings, string>>;
export type LobbyKey = keyof typeof lobbyLabels;
export const lobbyWords = {
  safetyCar: { off: 'off', reduced: 'reduced', standard: 'standard', increased: 'increased' },
  redFlags: { off: 'off', reduced: 'reduced', standard: 'standard', increased: 'increased' },
  carDamage: { off: 'off', reduced: 'reduced', standard: 'standard', simulation: 'simulation' },
  carDamageRate: { reduced: 'reduced', standard: 'standard', simulation: 'simulation' },
  tyreTemperature: { surfaceOnly: 'surface', surfaceAndCarcass: 'surface + carcass' },
  recoveryMode: { none: 'none', flashbacks: 'flashbacks', autoRecovery: 'auto recovery' },
} as const satisfies { [K in LobbyKey]: Record<GameSettings[K], string> };
export const noSessionHover = 'no session running';
export const noConfigHover = 'no session running: the effective config comes with one';

/** A value `config.json` set: its mark and hover. */
export const configSetMark = 'ʲ';
export const configSetHover = 'set in config.json';

/** The team names of the F1 25 grid by team id (Participants `teamId`); another id shows its number. */
const TEAM_NAMES: Readonly<Record<number, string>> = {
  0: 'Mercedes', 1: 'Ferrari', 2: 'Red Bull', 3: 'Williams', 4: 'Aston Martin', 5: 'Alpine', 6: 'RB', 7: 'Haas', 8: 'McLaren', 9: 'Sauber',
};
export const teamName = (team: TeamId): string => TEAM_NAMES[team] ?? `team ${team}`;
export const unlinkedHover = 'no person linked to this seat';

/** The bridge's reason for a rejected edit. */
export const rejected = (message: string): string => `rejected: ${message}`;
export const rejectedNoReason = 'not accepted';
export const linkLost = 'link lost';
/** An override text that is no number: rejected here, never sent (C73). */
export const notANumber = 'not a number';
