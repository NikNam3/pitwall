// The one rule for a car's three-letter code (displays through the kit, analyses that publish a code).
import type { CarIdentity } from './car.ts';

/** The three-letter car code: the first three letters of the name's last word, upper case; `#<n>` without a name. */
export function carCode(identity: Pick<CarIdentity, 'name' | 'raceNumber'>): string {
  const word = identity.name.trim().split(/\s+/).pop() ?? '';
  return word === '' ? `#${identity.raceNumber}` : word.slice(0, 3).toUpperCase();
}
