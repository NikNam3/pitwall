// Declaration of the circle-of-doom display (SP4.3d spec §6.5, V01; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html):
// the field as a lap circle around one of our cars, our car at the top, clockwise = behind us; our teammate a white ring;
// the ghosts of a stop now (G, V, S), the current condition's white with its rejoin place and the gaps around it.
// Written by the test phase from the plan's Task 14 interface (data, sizes), so the fixtures typecheck.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'circle-of-doom',
  title: 'Circle',
  data: {
    // The link group's primary car's circle (our cars only).
    circle: topic('circle.car', ({ link }) => ({ carId: link.primary })),
    // The field's identities: a car's code from its name (the kit's `carCode`), never its slot.
    cars: topic('cars.overview'),
    // Our cars (`playerCar`, `teammateCar`): the teammate is our car that is not the circle's.
    session: topic('session.info'),
  },
  // Mockup circle-of-doom.html: full a 420 px circle (53×22 cells), compact a 220 px one (28×12).
  sizes: { compact: { minCols: 28, minRows: 12 }, full: { minCols: 53, minRows: 22 } },
});
