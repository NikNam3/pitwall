// Pure helpers of the drivers panel: the seats from `drivers.links`, the shown form of a profile entry and its override,
// and the uiAction an override field commits (C65: formatting and the panel's own bookkeeping only; every value comes
// from the topics).
import type { UiAction } from '@pitwall/contracts';
import type { DriversLinksValue, DriversProfilesValue, PersonId, ProfileEntry, TeamId } from '@pitwall/domain';
import { fixed, formatSeconds, parseDecimal, parseSeconds } from '../../kit/values/format.ts';
import { entryLabels } from './text.ts';

export type Person = DriversProfilesValue['persons'][number];

/** A seat: a team and race number, and the person its link names (`null` without a link). */
export type Seat = { team: TeamId; raceNumber: number; person: PersonId | null };

export const seatKey = (s: { team: TeamId; raceNumber: number }): string => `${s.team}-${s.raceNumber}`;

/**
 * Every distinct seat of the links, our running feeds' unlinked human seats and the stored unlinked human slots, by race
 * number (then team), each with its linked person.
 */
export function seatsOf(links: DriversLinksValue): Seat[] {
  const seats = new Map<string, Seat>();
  const add = (team: TeamId, raceNumber: number, person: PersonId | null): void => {
    const k = seatKey({ team, raceNumber });
    if (!seats.has(k)) seats.set(k, { team, raceNumber, person });
  };
  for (const l of links.links) add(l.team, l.raceNumber, l.person);
  for (const s of links.unlinkedSeats) add(s.team, s.raceNumber, null);
  for (const s of links.unlinked) add(s.teamId, s.raceNumber, null);
  return [...seats.values()].toSorted((a, b) => a.raceNumber - b.raceNumber || a.team - b.team);
}

/** How an entry's value is typed and shown: in seconds (the topic's ms) or as it is, with its decimals. */
export type EntrySpec = { key: string; label: string; seconds: boolean; decimals: number };

/** The entries the panel knows: their units and decimals (mockup); another key shows as itself with two decimals. */
const SPECS: Readonly<Record<string, Omit<EntrySpec, 'key' | 'label'>>> = {
  'driverNoise.sigmaMs': { seconds: true, decimals: 3 },
  'driverNoise.rho': { seconds: false, decimals: 2 },
  'driverNoise.mistakeRate': { seconds: false, decimals: 3 },
  'driverNoise.mistakeMedianMs': { seconds: true, decimals: 1 },
  'driverNoise.mistakeSigmaLog': { seconds: false, decimals: 2 },
  'driverNoise.wearRatePct.soft': { seconds: false, decimals: 1 },
  'driverNoise.wearRatePct.medium': { seconds: false, decimals: 1 },
  'driverNoise.wearRatePct.hard': { seconds: false, decimals: 1 },
};
const OTHER: Omit<EntrySpec, 'key' | 'label'> = { seconds: false, decimals: 2 };

export const entrySpec = (key: string): EntrySpec => ({ key, label: entryLabels[key] ?? key, ...(SPECS[key] ?? OTHER) });

/** A number of the entry in its shown unit and decimals. */
export const entryText = (spec: EntrySpec, value: number): string => (spec.seconds ? formatSeconds(value, spec.decimals) : fixed(value, spec.decimals));

/** A person's entries in the topic's order, with their specs. */
export const entriesOf = (person: Person): { spec: EntrySpec; entry: ProfileEntry }[] =>
  Object.entries(person.entries).map(([key, entry]) => ({ spec: entrySpec(key), entry }));

/** The override field's text: the person's override in the entry's unit, empty without one. */
export const overrideText = (spec: EntrySpec, overrides: Record<string, number>): string => {
  const v = overrides[spec.key];
  return v === undefined ? '' : entryText(spec, v);
};

/**
 * What a committed override field sends: a number its `drivers.override` (seconds typed, ms sent), an empty field the
 * clear of an existing override; nothing for an empty field without one; `notANumber` for any other text.
 */
export function overrideAction(
  spec: EntrySpec, typed: string, person: PersonId, overrides: Record<string, number>,
): UiAction | 'notANumber' | undefined {
  if (typed.trim() === '') return overrides[spec.key] === undefined ? undefined : { kind: 'drivers.override.clear', person, key: spec.key };
  const value = spec.seconds ? parseSeconds(typed) : parseDecimal(typed);
  return value === undefined ? 'notANumber' : { kind: 'drivers.override', person, key: spec.key, value };
}
