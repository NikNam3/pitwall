import { carId, MAX_CARS, unknown, type CarIdentity, type DriverKey, type OwnCarState, type ParticipantsValues, type Visibility } from '@pitwall/domain';
import type { ParticipantsPacket } from '@pitwall/protocol';
import type { Frame } from '../../frame/frame.ts';
import type { LiveState } from '../../state/live-state.ts';
import { isActiveCar, slotsInUse } from '../active-cars.ts';
import { withholdRestricted } from './restricted.ts';
import type { StateUpdate } from './types.ts';

export { isActiveCar, slotsInUse } from '../active-cars.ts';

/** The key of the driver in a slot: the AI by `driverId`, a human by `networkId`, name and race number (spec 6.2). The one rule; the weekend context reuses it. A slot the packet lacks reads as an unknown AI driver. */
export const driverKeyOf = (p: ParticipantsPacket, carIndex: number): DriverKey => {
  const c = p.participants[carIndex];
  if (!c) return { kind: 'ai', driverId: 255 };
  return c.aiControlled === 1
    ? { kind: 'ai', driverId: c.driverId }
    : { kind: 'human', networkId: c.networkId, name: c.name, raceNumber: c.raceNumber };
};

/** What the identity wait hands the runner's `contextFor` (C61): the player's slot and the driver of each slot the session uses. */
export const participantsValuesOf = (frame: Frame, p: ParticipantsPacket): ParticipantsValues => ({
  playerCar: carId(frame.playerCarIndex),
  drivers: Array.from({ length: Math.min(p.numActiveCars, p.participants.length) }, (_, i) => ({ carId: carId(i), driverKey: driverKeyOf(p, i) })),
});

/** Participants `yourTelemetry = 0` hides a human's telemetry from everyone but themselves (Restricted data). */
const visibilityOf = (identity: Pick<CarIdentity, 'ai' | 'telemetryPublic'>, isPlayer: boolean): Visibility => {
  if (isPlayer) return 'own';
  return identity.ai || identity.telemetryPublic ? 'public' : 'restricted';
};

/** The slot's identity from Participants. It keeps the car's current `visibility`: `placePlayer` derives the new one after step 1's modules, so it sees the change. */
const identityFrom = (p: ParticipantsPacket, index: number, visibility: Visibility): CarIdentity | undefined => {
  const c = p.participants[index];
  if (!c) return undefined;
  const driverKey = driverKeyOf(p, index);
  const ai = driverKey.kind === 'ai';
  const telemetryPublic = c.yourTelemetry === 1;
  return {
    name: c.name,
    teamId: c.teamId,
    raceNumber: c.raceNumber,
    nationality: c.nationality,
    ai,
    driverId: c.driverId,
    networkId: c.networkId,
    myTeam: c.myTeam === 1,
    platform: c.platform,
    telemetryPublic,
    driverKey,
    visibility,
  };
};

/** Data only the player's car has, all unknown until its packets arrive. */
export const createOwnCarState = (): OwnCarState => ({
  motionEx: unknown('notReceived'),
  setup: unknown('notReceived'),
  brakeBiasPct: unknown('notReceived'),
});

/**
 * Makes `playerIndex` the player: `ownCar` and `own` visibility move to its car, and the teammate is found again.
 * A car that turns restricted loses what was stored while it looked public (packets before Participants). Runs after
 * every step-1 module (C11), so it reads the frame's identities and result statuses whatever order they ran in.
 */
export const placePlayer = (state: LiveState, playerIndex: number): void => {
  state.playerCar = carId(playerIndex);
  for (const car of state.cars) {
    const isPlayer = car.id === playerIndex;
    const visibility = visibilityOf(car.identity, isPlayer);
    if (visibility === 'restricted' && car.identity.visibility !== 'restricted') withholdRestricted(car);
    car.identity.visibility = visibility;
    if (!isPlayer) {
      if (car.ownCar) car.ownCar = undefined;
    } else {
      car.ownCar ??= createOwnCarState();
    }
  }
  const teamId = state.cars[playerIndex]?.identity.teamId;
  const slots = slotsInUse(state);
  state.teammateCar = state.cars.find(
    (car) => car.id !== playerIndex && car.identity.teamId === teamId && isActiveCar(car.id, slots, car.timing.resultStatus),
  )?.id;
};

/** The identities from Participants; tags `identity` when they arrive or the player changes (step 1 then places the player). */
export const identityUpdate: StateUpdate = {
  id: 'identity',
  apply(frame, live, _signals, out) {
    const p = frame.participants;
    const playerChanged = frame.playerCarIndex !== live.playerCar;
    if (p) {
      live.session.numActiveCars = p.numActiveCars;
      for (let i = 0; i < MAX_CARS; i++) {
        const car = live.cars[i];
        if (!car) continue;
        const identity = identityFrom(p, i, car.identity.visibility);
        if (!identity) continue;
        car.identity = identity;
        car.updatedAt.participants = frame.sessionTime;
      }
    }
    if (p || playerChanged) out.changed.add('identity');
  },
};
