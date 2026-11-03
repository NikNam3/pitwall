// Random signal sequences for the sub-machine property (contract C12, C85): one session's signals frame by frame. The
// session type, weekend structure, rule set and number of marshal zones hold for the session; the other signals change
// in bursts (a few cars, a few session fields, up to two events) and then hold for up to 40 frames, so confirmations
// that wait for a signal to last get their chance. FLBK is left out: a flashback is the runner's, never a machine input.
import fc from 'fast-check';
import { carId, MAX_CARS, type CarId } from '@pitwall/domain';
import type { CarSignals, DrsDisabledReason, RetirementReason, SessionSignals, Signals, SituationEvent } from '../../src/signals/types.ts';
import { SAFETY_CAR_STATUS, ZONE_FLAG } from '../../src/step/state-update/session.ts';
import { DRIVER_STATUS, PIT_STATUS, RESULT_STATUS } from '../../src/step/state-update/timing.ts';

const RETIREMENT_REASONS = [
  'invalid',
  'retired',
  'finished',
  'terminalDamage',
  'inactive',
  'notEnoughLapsCompleted',
  'blackFlagged',
  'redFlagged',
  'mechanicalFailure',
  'sessionSkipped',
  'sessionSimulated',
] as const satisfies readonly RetirementReason[];
const DRS_DISABLED_REASONS = ['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached'] as const satisfies readonly DrsDisabledReason[];

const arbCar: fc.Arbitrary<CarId> = fc.integer({ min: 0, max: MAX_CARS - 1 }).map(carId);
const arbMaybeCar = fc.option(arbCar, { nil: undefined });
const count = (max: number) => fc.integer({ min: 0, max });

/** Some of a car's signals, each from its full range. */
const arbCarChange: fc.Arbitrary<Partial<CarSignals>> = fc.record(
  {
    pitStatus: fc.constantFrom(...PIT_STATUS),
    driverStatus: fc.constantFrom(...DRIVER_STATUS),
    pitLaneTimerActive: fc.boolean(),
    resultStatus: fc.constantFrom(...RESULT_STATUS),
    numPitStops: count(4),
    shouldServePenalty: fc.boolean(),
    unservedDriveThroughs: count(3),
    unservedStopGos: count(3),
    timePenaltyMs: count(6).map((n) => n * 5_000),
    totalWarnings: count(12),
    cornerCuttingWarnings: count(12),
    currentLapInvalid: fc.boolean(),
    fiaFlag: fc.constantFrom(...ZONE_FLAG),
    drsAllowed: fc.boolean(),
    networkPaused: fc.boolean(),
    aiControlled: fc.boolean(),
  },
  { requiredKeys: [] },
);

/** Some of the session's signals that change within a session. */
const arbSessionChange: fc.Arbitrary<Partial<Omit<SessionSignals, 'sessionType' | 'weekendStructure' | 'ruleSet' | 'marshalZones'>>> = fc.record(
  {
    safetyCarStatus: fc.constantFrom(...SAFETY_CAR_STATUS),
    periods: fc.record({ sc: count(3), vsc: count(3), red: count(2) }),
    gamePaused: fc.boolean(),
    isSpectating: fc.boolean(),
    spectatorCarIndex: arbMaybeCar,
    numActiveCars: fc.integer({ min: 1, max: MAX_CARS }),
  },
  { requiredKeys: [] },
);

/** Every C12 event but FLBK. */
const arbEvent: fc.Arbitrary<SituationEvent> = fc.oneof(
  fc.constantFrom<SituationEvent>({ code: 'SSTA' }, { code: 'SEND' }, { code: 'CHQF' }, { code: 'LGOT' }, { code: 'RDFL' }, { code: 'DRSE' }),
  fc.constantFrom(...DRS_DISABLED_REASONS).map((reason): SituationEvent => ({ code: 'DRSD', reason })),
  fc.integer({ min: 1, max: 5 }).map((lights): SituationEvent => ({ code: 'STLG', lights })),
  fc
    .record({ car: fc.constantFrom('none', 'SC', 'VSC', 'formation'), stage: fc.constantFrom('deployed', 'returning', 'returned', 'resume') })
    .map((r): SituationEvent => ({ code: 'SCAR', ...r })),
  fc.record({ code: fc.constantFrom('RCWN', 'DTSV', 'TMPT'), carId: arbMaybeCar }).map((r) => r as SituationEvent),
  fc.record({ carId: arbMaybeCar, reason: fc.constantFrom(...RETIREMENT_REASONS) }).map((r): SituationEvent => ({ code: 'RTMT', ...r })),
  fc
    .record({
      carId: arbMaybeCar,
      otherCarId: arbMaybeCar,
      penaltyType: count(17),
      infringementType: count(54),
      timeMs: fc.option(count(10).map((s) => s * 1_000), { nil: undefined }),
      lap: count(70),
      placesGained: count(3),
    })
    .map((r): SituationEvent => ({ code: 'PENA', ...r })),
  fc.record({ carId: arbMaybeCar, stopTimeMs: count(10).map((s) => s * 1_000) }).map((r): SituationEvent => ({ code: 'SGSV', ...r })),
);

/** One burst of changes and how many frames the result holds (the first carries the events). */
const arbBurst = fc.record({
  hold: fc.integer({ min: 1, max: 40 }),
  cars: fc.array(fc.tuple(arbCar, arbCarChange), { maxLength: 4 }),
  session: arbSessionChange,
  zoneFlags: fc.array(fc.tuple(count(20), fc.constantFrom(...ZONE_FLAG)), { maxLength: 3 }),
  events: fc.array(arbEvent, { maxLength: 2 }),
});

/** What holds for the whole session. */
const arbSessionFixed = fc.record({
  sessionType: count(19),
  weekendStructure: fc.array(fc.integer({ min: 1, max: 18 }), { maxLength: 12 }),
  ruleSet: count(13),
  zones: count(21),
});

/** One session's signals frame by frame, starting from `initial` (a fresh state's signals). */
export const arbSignalSequence = (initial: Signals): fc.Arbitrary<Signals[]> =>
  fc.tuple(arbSessionFixed, fc.array(arbBurst, { minLength: 1, maxLength: 12 })).map(([fixed, bursts]) => {
    let current: Signals = {
      cars: initial.cars.map((c) => ({ ...c })),
      session: {
        ...initial.session,
        sessionType: fixed.sessionType,
        weekendStructure: fixed.weekendStructure,
        ruleSet: fixed.ruleSet,
        marshalZones: Array.from({ length: fixed.zones }, (_, i) => ({ startFraction: i / Math.max(fixed.zones, 1), flag: 'green' as const })),
      },
      events: [],
    };
    const frames: Signals[] = [];
    for (const burst of bursts) {
      const cars = current.cars.map((c) => ({ ...c }));
      for (const [car, change] of burst.cars) Object.assign(cars[car]!, change);
      const marshalZones = current.session.marshalZones.map((z, i) => {
        const flag = burst.zoneFlags.findLast(([zone]) => zone === i)?.[1];
        return flag === undefined ? z : { ...z, flag };
      });
      current = { cars, session: { ...current.session, ...burst.session, marshalZones }, events: burst.events };
      frames.push(current);
      for (let k = 1; k < burst.hold; k++) frames.push({ ...current, events: [] });
    }
    return frames;
  });
