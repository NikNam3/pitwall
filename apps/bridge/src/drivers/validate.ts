// The driver-profile uiActions checked against the persons, the stored sessions and the entries' declarations (C62c,
// C73; SP4.3a spec 4): a valid one gives the person files it writes, an invalid one its reason, and changes nothing.
import type { DriverAction, UiAction } from '@pitwall/contracts';
import type { DriverLink, DriverPerson, UnlinkedSlot } from '@pitwall/domain';
import type { ProfileEntryDecl } from '@pitwall/engine/readers';
import { sameSeat, type StoredSlot } from './links.ts';
import { isPersonId, sameSession } from './persons.ts';

/** Whether a uiAction is a driver-profile one, the profile store's (C62c). */
export const isDriverAction = (action: UiAction): action is DriverAction => action.kind.startsWith('drivers.');

export type Checked = { ok: true; write: DriverPerson[] } | { ok: false; message: string };

export type CheckCtx = {
  persons: ReadonlyMap<string, DriverPerson>;
  /** Every slot of every stored session. */
  slots: readonly StoredSlot[];
  /** The unlinked slots as last shown (`drivers.links`). */
  unlinked: readonly UnlinkedSlot[];
  entry: (key: string) => ProfileEntryDecl | undefined;
};

const invalid = (message: string): Checked => ({ ok: false, message });
const write = (...persons: DriverPerson[]): Checked => ({ ok: true, write: persons });

/**
 * `drivers.link`: one seat, one person. The seat's link is removed from every person that has it, then added to the
 * named one; `person: null` only removes it. An unknown person, or a seat that is not one, is rejected.
 */
function checkLink(action: Extract<DriverAction, { kind: 'drivers.link' }>, ctx: CheckCtx): Checked {
  const seat: DriverLink = { team: action.team, raceNumber: action.raceNumber };
  if (!Number.isInteger(seat.team) || seat.team < 0) return invalid(`a team is a team id (an integer from 0), got ${seat.team}`);
  if (!Number.isInteger(seat.raceNumber) || seat.raceNumber < 0) return invalid(`a race number is an integer from 0, got ${seat.raceNumber}`);
  const target = action.person === null ? undefined : ctx.persons.get(action.person);
  if (action.person !== null && target === undefined) return invalid(`no person ${action.person}`);
  const changed = new Map<string, DriverPerson>();
  for (const person of ctx.persons.values()) {
    if (person.links.some((l) => sameSeat(l, seat))) changed.set(person.id, { ...person, links: person.links.filter((l) => !sameSeat(l, seat)) });
  }
  if (target !== undefined) {
    const base = changed.get(target.id) ?? target;
    changed.set(target.id, { ...base, links: [...base.links, seat] });
  }
  return write(...changed.values());
}

export function checkAction(action: DriverAction, ctx: CheckCtx): Checked {
  if (action.kind === 'drivers.add') {
    if (!isPersonId(action.person)) return invalid(`a person id is kebab-case (a-z, 0-9, -): ${JSON.stringify(action.person)}`);
    if (ctx.persons.has(action.person)) return invalid(`person ${action.person} exists already`);
    const displayName = action.displayName.trim();
    if (displayName === '') return invalid('a person needs a display name');
    return write({ id: action.person, displayName, links: [], excluded: [], overrides: {} });
  }
  if (action.kind === 'drivers.link') return checkLink(action, ctx);
  const person = ctx.persons.get(action.person);
  if (person === undefined) return invalid(`no person ${action.person}`);
  switch (action.kind) {
    case 'drivers.exclude': {
      if (!ctx.slots.some((s) => sameSession(s.session, action.session))) {
        return invalid(`no stored session ${action.session.sessionUid}/${action.session.weekendId}/${action.session.feedCar}`);
      }
      if (person.excluded.some((e) => sameSession(e, action.session))) return write(person);
      return write({ ...person, excluded: [...person.excluded, action.session] });
    }
    case 'drivers.override': {
      const entry = ctx.entry(action.key);
      if (entry === undefined) return invalid(`no profile entry ${action.key}`);
      const [min, max] = entry.range;
      if (!Number.isFinite(action.value) || action.value < min || action.value > max) return invalid(`${action.key} must lie in [${min}, ${max}], got ${action.value}`);
      return write({ ...person, overrides: { ...person.overrides, [action.key]: action.value } });
    }
    case 'drivers.override.clear': {
      if (ctx.entry(action.key) === undefined) return invalid(`no profile entry ${action.key}`);
      const { [action.key]: _cleared, ...overrides } = person.overrides;
      return write({ ...person, overrides });
    }
  }
}
