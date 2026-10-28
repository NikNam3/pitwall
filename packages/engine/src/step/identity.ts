import { carId, MAX_CARS, unknown, type CarIdentity, type DriverKey, type OwnCarState, type ResultStatus, type Visibility } from '@pitwall/domain';
import type { ParticipantsPacket } from '@pitwall/protocol';
import type { EngineState } from '../state/engine-state.ts';
import { withholdRestricted } from './restricted.ts';
import type { SubStep } from './types.ts';

/** The key of the driver in a slot: the AI by `driverId`, a human by `networkId`, name and race number (spec 6.2). The one rule; the weekend context reuses it. A slot the packet lacks reads as an unknown AI driver. */
export const driverKeyOf = (p: ParticipantsPacket, carIndex: number): DriverKey => {
  const c = p.participants[carIndex];
  if (!c) return { kind: 'ai', driverId: 255 };
  return c.aiControlled === 1
    ? { kind: 'ai', driverId: c.driverId }
    : { kind: 'human', networkId: c.networkId, name: c.name, raceNumber: c.raceNumber };
};

/** Whether the car is in the session: a slot below `numActiveCars` that the game has not marked invalid or inactive. */
export const isActiveCar = (index: number, numActiveCars: number, resultStatus: ResultStatus): boolean =>
  index < numActiveCars && resultStatus !== 'invalid' && resultStatus !== 'inactive';

/** Participants `yourTelemetry = 0` hides a human's telemetry from everyone but themselves (Restricted data). */
const visibilityOf = (identity: Pick<CarIdentity, 'ai' | 'telemetryPublic'>, isPlayer: boolean): Visibility => {
  if (isPlayer) return 'own';
  return identity.ai || identity.telemetryPublic ? 'public' : 'restricted';
};

/** The slot's identity from Participants. It keeps the car's current `visibility`: `placePlayer` derives the new one, so it sees the change. */
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
 * A car that turns restricted loses what was stored while it looked public (packets before Participants).
 */
export const placePlayer = (state: EngineState, playerIndex: number): void => {
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
  state.teammateCar = state.cars.find(
    (car) =>
      car.id !== playerIndex &&
      car.identity.teamId === teamId &&
      isActiveCar(car.id, state.session.numActiveCars, car.timing.resultStatus),
  )?.id;
};

export const applyIdentity: SubStep = (state, frame, out) => {
  const p = frame.participants;
  const playerChanged = frame.playerCarIndex !== state.playerCar;
  if (p) {
    state.session.numActiveCars = p.numActiveCars;
    for (let i = 0; i < MAX_CARS; i++) {
      const car = state.cars[i];
      if (!car) continue;
      const identity = identityFrom(p, i, car.identity.visibility);
      if (!identity) continue;
      car.identity = identity;
      car.updatedAt.participants = frame.sessionTime;
    }
  }
  if (!p && !playerChanged) return;
  placePlayer(state, frame.playerCarIndex);
  out.changed.add('identity');
};
