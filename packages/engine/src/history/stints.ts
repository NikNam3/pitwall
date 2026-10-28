import type { CarState } from '@pitwall/domain';
import type { EngineState, OpenStint } from '../state/engine-state.ts';
import type { SubStep } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';

const openStint = (car: CarState, firstLap: number): OpenStint => ({
  firstLap,
  actualCompound: car.tyres.actualCompound,
  visualCompound: car.tyres.visualCompound,
  tyreAgeAtFitting: car.tyres.age,
  lastAge: car.tyres.age,
});

/** Records the stint; one without a completed lap (the tyres changed before the first lap ended) is dropped. */
const closeStint = (state: EngineState, car: CarState, stint: OpenStint, lastLap: number): void => {
  if (lastLap < stint.firstLap) return;
  const { firstLap, actualCompound, visualCompound, tyreAgeAtFitting } = stint;
  state.history.stints.push({ carId: car.id, firstLap, lastLap, actualCompound, visualCompound, tyreAgeAtFitting });
};

/** A new set is fitted when the compound changes or the age drops (a fresh set of the same compound). */
const trackStint = (state: EngineState, car: CarState): void => {
  const { actualCompound, age } = car.tyres;
  if (actualCompound === 'unknown') return;
  const stint = state.open.stints[car.id];
  if (!stint) {
    state.open.stints[car.id] = openStint(car, car.timing.lap);
    return;
  }
  if (actualCompound === stint.actualCompound && age >= stint.lastAge) {
    stint.lastAge = age;
    return;
  }
  // Tyres are changed in the box, so an open pit visit tells which lap the old stint ended on.
  const visit = state.open.pitVisits[car.id];
  const lastLap = visit ? visit.lap : car.timing.lap - 1;
  closeStint(state, car, stint, lastLap);
  state.open.stints[car.id] = openStint(car, lastLap + 1);
};

/** Stints come from Car Status; `SEND` closes the stint every car is still on. */
export const applyStints: SubStep = (state, frame, out) => {
  const before = state.history.stints.length;
  for (const car of carsWithLapData(state, frame)) trackStint(state, car);
  if (frame.events.some(({ details }) => details.code === 'SEND')) {
    for (const car of state.cars) {
      const stint = state.open.stints[car.id];
      if (!stint) continue;
      closeStint(state, car, stint, car.timing.lap - 1);
      state.open.stints[car.id] = undefined;
    }
  }
  if (state.history.stints.length > before) out.changed.add('stints');
};
