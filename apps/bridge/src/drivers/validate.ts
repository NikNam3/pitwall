// The driver-profile uiActions checked against the persons, the stored sessions and the entries' declarations (C62c,
// C73; SP4.3a spec 4): a valid one gives the person files it writes, an invalid one its reason, and changes nothing.
import type { DriverAction, UiAction } from '@pitwall/contracts';
import type { DriverLink, DriverPerson, UnlinkedSlot } from '@pitwall/domain';
import type { ProfileEntryDecl } from '@pitwall/engine/readers';
import { linkFor, type StoredSlot } from './links.ts';
import { isPersonId, sameLink, sameSession } from './persons.ts';

/** Whether a uiAction is a driver-profile one, the profile store's (C62c). */
export const isDriverAction = (action: UiAction): action is DriverAction => action.kind.startsWith('drivers.');

export type Checked = { ok: true; write: DriverPerson[] } | { ok: false; message: string };

export type CheckCtx = {
  persons: ReadonlyMap<string, DriverPerson>;
  /** Every slot of every stored session. */
  slots: readonly StoredSlot[];
  /** The unlinked slots as last shown (`drivers.links`), with their suggestions. */
  unlinked: readonly UnlinkedSlot[];
  entry: (key: string) => ProfileEntryDecl | undefined;
};

const invalid = (message: string): Checked => ({ ok: false, message });
const write = (...persons: DriverPerson[]): Checked => ({ ok: true, write: persons });

/** The person with `link` added; unchanged when it holds that link already. */
const withLink = (person: DriverPerson, link: DriverLink): DriverPerson =>
  person.links.some((l) => sameLink(l, link)) ? person : { ...person, links: [...person.links, link] };

export function checkAction(action: DriverAction, ctx: CheckCtx): Checked {
  if (action.kind === 'drivers.add') {
    if (!isPersonId(action.person)) return invalid(`a person id is kebab-case (a-z, 0-9, -): ${JSON.stringify(action.person)}`);
    if (ctx.persons.has(action.person)) return invalid(`person ${action.person} exists already`);
    const displayName = action.displayName.trim();
    if (displayName === '') return invalid('a person needs a display name');
    return write({ id: action.person, displayName, links: [], excluded: [], overrides: {} });
  }
  if (action.kind === 'drivers.accept') return accept(ctx);
  const person = ctx.persons.get(action.person);
  if (person === undefined) return invalid(`no person ${action.person}`);
  switch (action.kind) {
    case 'drivers.link': {
      const slot = ctx.slots.find((s) => sameSession(s.session, action.session) && s.carId === action.carId);
      if (slot === undefined) return invalid(`no stored slot ${action.carId} in session ${action.session.sessionUid}/${action.session.weekendId}/${action.session.feedCar}`);
      return write(withLink(person, linkFor(slot)));
    }
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

/** Every shown suggestion confirmed as a link of its person: by name and race number when the slot has a name, else the slot. */
function accept(ctx: CheckCtx): Checked {
  const changed = new Map<string, DriverPerson>();
  for (const shown of ctx.unlinked) {
    if (shown.suggestion === undefined) continue;
    const person = changed.get(shown.suggestion.person) ?? ctx.persons.get(shown.suggestion.person);
    if (person === undefined) continue;
    changed.set(person.id, withLink(person, linkFor(shown)));
  }
  return write(...changed.values());
}
