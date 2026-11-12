// The compound rule's one judgement (SP4.3b Task 11d, contract C43): whether a car still owes a stop for a second dry
// compound. The compound-rule sub-machine holds `required` for the whole dry race (the rule applies); whether the car has
// met it, by running two distinct dry compounds in its closed stints and its current set, is judged here, once, for every
// unit that needs it (rival-stops, strategy).
import type { CarId, StintRecord, VisualCompound } from '@pitwall/domain';

export type DryCompound = 'soft' | 'medium' | 'hard';

const DRY: readonly VisualCompound[] = ['soft', 'medium', 'hard'];
const isDry = (c: VisualCompound): c is DryCompound => DRY.includes(c);

/** The distinct dry compounds `car` has used in the race: those of its closed stints and of the set it runs now. */
export function dryCompoundsUsed(history: { readonly stints: readonly Readonly<StintRecord>[] }, car: CarId, currentSet?: VisualCompound): ReadonlySet<DryCompound> {
  const used = new Set<DryCompound>();
  for (const s of history.stints) if (s.carId === car && isDry(s.visualCompound)) used.add(s.visualCompound);
  if (currentSet !== undefined && isDry(currentSet)) used.add(currentSet);
  return used;
}

/** Whether `car` still owes a stop for the rule: it is `required` and the car has used fewer than two dry compounds. */
export function owesSecondDryCompound(
  rule: 'required' | 'waived',
  history: { readonly stints: readonly Readonly<StintRecord>[] },
  car: CarId,
  currentSet?: VisualCompound,
): boolean {
  return rule === 'required' && dryCompoundsUsed(history, car, currentSet).size < 2;
}
