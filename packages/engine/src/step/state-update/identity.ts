import { carId, MAX_CARS, unknown, type CarIdentity, type CarState, type DriverKey, type OwnCarState, type ParticipantsValues, type Visibility } from '@pitwall/domain';
import type { ParticipantsPacket } from '@pitwall/protocol';
import type { Frame } from '../../frame/frame.ts';
import type { LiveState } from '../../state/live-state.ts';
import type { Signals } from '../../signals/types.ts';
import { isActiveCar, slotsInUse } from '../../situations/car-status/slots.ts';
import { maskCarForRealism } from './realism.ts';
import { withholdRestricted } from './restricted.ts';
import type { StateUpdate } from './types.ts';

/**
 * The key of the driver in a slot: its name and network id, AI or human alike (spec 6.2; `aiControlled` is a signal,
 * C12, C13). The one rule; the weekend context reuses it. A slot the packet lacks reads as no name on network id 255.
 */
export const driverKeyOf = (p: ParticipantsPacket, carIndex: number): DriverKey => {
  const c = p.participants[carIndex];
  return c ? { name: c.name, networkId: c.networkId } : { name: '', networkId: 255 };
};

/**
 * What the identity wait hands the runner's `contextFor` (C61): the player's slot and the driver of every slot the
 * Participants packet carries. No signal caps the list (C13): which cars are in the session is car-status's (C43).
 */
export const participantsValuesOf = (frame: Frame, p: ParticipantsPacket): ParticipantsValues => ({
  playerCar: carId(frame.playerCarIndex),
  drivers: p.participants.map((_, i) => ({ carId: carId(i), driverKey: driverKeyOf(p, i) })),
});

/**
 * Participants `yourTelemetry = 0` hides a human's telemetry from everyone but themselves (Restricted data); an AI stays
 * public. Whether the AI drives the car is the `aiControlled` signal, which step 1 wrote this frame (C8, C13).
 */
const visibilityOf = (ai: boolean, telemetryPublic: boolean, isPlayer: boolean): Visibility => {
  if (isPlayer) return 'own';
  return ai || telemetryPublic ? 'public' : 'restricted';
};

/** Whether the AI drives the car, by the signals of this frame; a slot without signals reads as the AI. */
const aiControlled = (signals: Pick<Signals, 'cars'>, car: CarState): boolean => signals.cars[car.id]?.aiControlled ?? true;

/**
 * The car's visibility after this frame, from the frame's Participants and player (else the car's identity as it was)
 * and the signals: what the identity module will set, so the other step-1 modules read it from their input in any
 * order (C11).
 */
export const visibilityIn = (frame: Frame, car: CarState, signals: Pick<Signals, 'cars'>): Visibility => {
  const c = frame.participants?.participants[car.id];
  const telemetryPublic = c ? c.yourTelemetry === 1 : car.identity.telemetryPublic;
  return visibilityOf(aiControlled(signals, car), telemetryPublic, car.id === frame.playerCarIndex);
};

/** The slot's identity from Participants. It keeps the car's current `visibility`: `placePlayer` derives the new one, so it sees the change. */
const identityFrom = (p: ParticipantsPacket, index: number, visibility: Visibility): CarIdentity | undefined => {
  const c = p.participants[index];
  if (!c) return undefined;
  return {
    name: c.name,
    teamId: c.teamId,
    raceNumber: c.raceNumber,
    nationality: c.nationality,
    driverId: c.driverId,
    networkId: c.networkId,
    myTeam: c.myTeam === 1,
    platform: c.platform,
    telemetryPublic: c.yourTelemetry === 1,
    driverKey: driverKeyOf(p, index),
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
 * Makes `playerIndex` the player: `ownCar` and `own` visibility move to its car, and the teammate is found again among
 * the cars in the session by car-status's rule over `signals` (step 1's of this frame, C8, C13). A car that turns
 * restricted loses what was stored while it looked public (packets before Participants); realism's masks stay on it.
 */
export const placePlayer = (state: LiveState, playerIndex: number, signals: Pick<Signals, 'cars' | 'session'>): void => {
  state.playerCar = carId(playerIndex);
  for (const car of state.cars) {
    const isPlayer = car.id === playerIndex;
    const visibility = visibilityOf(aiControlled(signals, car), car.identity.telemetryPublic, isPlayer);
    if (visibility === 'restricted' && car.identity.visibility !== 'restricted') {
      withholdRestricted(car);
      maskCarForRealism(state, car);
    }
    car.identity.visibility = visibility;
    if (!isPlayer) {
      if (car.ownCar) car.ownCar = undefined;
    } else {
      car.ownCar ??= createOwnCarState();
    }
  }
  const teamId = state.cars[playerIndex]?.identity.teamId;
  const slots = slotsInUse(signals);
  state.teammateCar = state.cars.find((car) => {
    const resultStatus = signals.cars[car.id]?.resultStatus;
    return car.id !== playerIndex && car.identity.teamId === teamId && resultStatus !== undefined && isActiveCar(car.id, slots, resultStatus);
  })?.id;
};

/**
 * The identities from Participants, and the player placed when they arrive or the player changes (tagged `identity`).
 * The teammate is placed by the signals step 1 wrote this frame (C8), never by another module's write (C11).
 */
export const identityUpdate: StateUpdate = {
  id: 'identity',
  apply(frame, live, signals, out) {
    const p = frame.participants;
    const playerChanged = frame.playerCarIndex !== live.playerCar;
    if (p) {
      for (let i = 0; i < MAX_CARS; i++) {
        const car = live.cars[i];
        if (!car) continue;
        const identity = identityFrom(p, i, car.identity.visibility);
        if (!identity) continue;
        car.identity = identity;
        car.updatedAt.participants = frame.sessionTime;
      }
    }
    if (!p && !playerChanged) return;
    placePlayer(live, frame.playerCarIndex, signals);
    out.changed.add('identity');
  },
};
