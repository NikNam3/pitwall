// A guarded `MachineInput` (contract C15, C41): a sub-machine reads only the inputs it declares (`inputs.signals`,
// `inputs.values`, `inputs.upstream`). The guard wraps one frame's input so that a read outside the declaration throws
// an `UndeclaredReadError` and is noted, by its path:
// - `signals`: the declared signal keys only, at session level (`signals.session.<key>`) and at car level
//   (`signals.cars[i].<key>`); `signals.cars` only when a car signal is declared; `signals.events` only when `events` is;
// - `live`: the declared live areas only, by the fields step 1's module of each area writes (`LIVE_AREA_FIELDS`); a car's
//   `id` (its slot, no value) and its `updatedAt` (the freshness of its values) with any car area; `live.cars` only
//   when a car area is declared;
// - `upstream`: the declared machine ids only.
// The frame's time, id and number, the clock's state (step 0's, not an upstream, C7) and the weekend phase (C14) are no
// declared input: every sub-machine may read them.
import type { MachineId } from '@pitwall/domain';
import type { MachineInput, MachineInputs } from '../../src/situations/machine.ts';
import type { LiveArea } from '../../src/state/live-state.ts';

/** The fields of the live state each area's step-1 module writes (`step/state-update/`): the state's own, and each car's. */
export const LIVE_AREA_FIELDS: Readonly<Record<LiveArea, { state: readonly string[]; car: readonly string[] }>> = {
  session: { state: ['session'], car: [] },
  identity: { state: ['playerCar', 'teammateCar'], car: ['identity'] },
  timing: { state: [], car: ['timing'] },
  tyres: { state: [], car: ['tyres'] },
  energy: { state: [], car: ['energy'] },
  condition: { state: [], car: ['condition'] },
  dynamics: { state: [], car: ['dynamics', 'motion'] },
  ownCar: { state: [], car: ['ownCar'] },
};

/** The session-level signal keys (`SessionSignals`); every other `SignalKey` but `events` is a car's. */
const SESSION_SIGNALS: ReadonlySet<string> = new Set([
  'safetyCarStatus', 'marshalZones', 'periods', 'sessionType', 'weekendStructure', 'ruleSet', 'gamePaused', 'isSpectating', 'spectatorCarIndex', 'numActiveCars',
]);

/**
 * A sub-machine read an input it does not declare (C15), or a unit a part of its view (C41, `guardedView` in
 * `scheduler.ts`): `reader` is the machine's or the unit's id.
 */
export class UndeclaredReadError extends Error {
  readonly path: string;

  constructor(reader: MachineId, path: string, clause: 'C15' | 'C41' = 'C15') {
    super(`${reader} reads ${path}, which it does not declare (${clause})`);
    this.path = path;
  }
}

/**
 * `target` behind a proxy that lets reads of `allowed` through and throws on any other own property, noting its path.
 * Symbols and the prototype's members (an array's `map`, `length`) pass, so iterating a guarded list works. `strict`:
 * a key the target does not hold throws too (an upstream id is a key whether or not the frame has its spans).
 */
const guard = <T extends object>(target: T, allowed: (key: string) => boolean, path: string, onRead: (path: string) => never, strict = false): T =>
  new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'symbol' || allowed(key) || (!strict && !Object.prototype.hasOwnProperty.call(t, key))) return Reflect.get(t, key, receiver);
      return onRead(`${path}.${key}`);
    },
  });

/** A list nothing may read: any element, its length or a method. */
const sealed = <T extends object>(target: T, path: string, onRead: (path: string) => never): T =>
  new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(t, key, receiver);
      return onRead(`${path}${/^\d+$/.test(key) ? `[${key}]` : `.${key}`}`);
    },
  });

/**
 * `input` guarded by `inputs`, the declaration of `machine` (C15). Every read outside it is passed to `noted` and throws
 * an `UndeclaredReadError`. The input itself is not changed: the guard reads through to it.
 */
export function guardedInput(machine: MachineId, inputs: MachineInputs, input: MachineInput, noted: (path: string) => void = () => {}): MachineInput {
  const onRead = (path: string): never => {
    noted(path);
    throw new UndeclaredReadError(machine, path);
  };
  const signalKeys = new Set<string>(inputs.signals);
  const carSignals = inputs.signals.filter((k) => k !== 'events' && !SESSION_SIGNALS.has(k));
  const areas = inputs.values.map((a) => LIVE_AREA_FIELDS[a]);
  const stateFields = new Set(areas.flatMap((a) => a.state));
  const carFields = new Set(areas.flatMap((a) => a.car));
  if (carFields.size > 0) carFields.add('updatedAt');

  const { signals, live } = input;
  const guardedSignals = guard(
    {
      ...signals,
      session: guard(signals.session, (k) => signalKeys.has(k), 'signals.session', onRead),
      cars:
        carSignals.length > 0
          ? signals.cars.map((car, i) => guard(car, (k) => signalKeys.has(k), `signals.cars[${i}]`, onRead))
          : sealed(signals.cars, 'signals.cars', onRead),
    },
    (k) => k === 'session' || (k === 'cars' && carSignals.length > 0) || (k === 'events' && signalKeys.has('events')),
    'signals',
    onRead,
  );
  const cars =
    carFields.size > 0
      ? live.cars.map((car, i) => guard(car, (k) => k === 'id' || carFields.has(k), `live.cars[${i}]`, onRead))
      : sealed(live.cars, 'live.cars', onRead);
  const guardedLive = guard({ ...live, cars }, (k) => stateFields.has(k) || (k === 'cars' && carFields.size > 0), 'live', onRead);
  const declaredUpstream = new Set(inputs.upstream);
  const guardedUpstream = guard({ ...input.upstream }, (k) => declaredUpstream.has(k), 'upstream', onRead, true);
  return { ...input, signals: guardedSignals, live: guardedLive, upstream: guardedUpstream };
}
