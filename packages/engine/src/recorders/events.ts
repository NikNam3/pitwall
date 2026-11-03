import { MAX_CARS } from '@pitwall/domain';
import type { Recorder } from '../step/types.ts';
import { recordDamageChanges, type DamageReadings } from './damage-changes.ts';

/** The events recorder's own open state (C10): the damage readings `damageChange` compares with. */
export type EventsOwn = { damage: DamageReadings };

/**
 * The race history's events, in the order they arrived: the situation events still recorded as race events (step 2's
 * `tracked.raceEvents`, until Task 21), the frame's value events (`live.frameEvents`, step 1), then the damage changes.
 */
export const eventsRecorder: Recorder<EventsOwn> = {
  id: 'events',
  init: () => ({ damage: Array.from({ length: MAX_CARS }, () => undefined) }),
  apply(input, own, log, out) {
    const { at } = input;
    const bodies = [...(input.tracked?.raceEvents ?? []), ...input.live.frameEvents];
    for (const body of bodies) log.append('events', { at, ...body, in: {} });
    if (recordDamageChanges(input, own.damage, log) || bodies.length > 0) out.changed.add('events');
    return own;
  },
};
