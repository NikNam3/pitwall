import type { CarIdentity } from '@pitwall/domain';

/** The three-letter car code: the first three letters of the name's last word, upper case; `#<n>` without a name. */
export function carCode(identity: Pick<CarIdentity, 'name' | 'raceNumber'>): string {
  const word = identity.name.trim().split(/\s+/).pop() ?? '';
  return word === '' ? `#${identity.raceNumber}` : word.slice(0, 3).toUpperCase();
}
