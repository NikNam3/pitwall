// Packet values a recorder needs become live values in step 1 (C6, C8): the confirmed laps of Session History and the
// frame's value events (OVTK, COLL, FTLP, SPTP), in domain units, so no recorder reads a packet.
import { describe, expect, it } from 'vitest';
import { carId, type FrameEvent } from '@pitwall/domain';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

describe('confirmed laps', () => {
  it("a Session History packet fills the car's confirmedLaps with its completed laps, in ms, with their validity", () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(2, (d) => {
      if (d.index !== 1) return;
      d.add('sessionHistory', {
        carIdx: 1,
        numLaps: 3,
        lapHistoryData: {
          0: { lapTimeInMs: 90_000, sector1TimeMs: 30_000, sector2TimeMs: 31_000, sector3TimeMs: 29_000, lapValidBitFlags: 0x0f },
          1: { lapTimeInMs: 91_500, sector1TimeMs: 30_500, sector2TimeMs: 31_500, sector3TimeMs: 29_500, lapValidBitFlags: 0x05 },
          // the lap in progress: no time yet
          2: { lapTimeInMs: 0, sector1TimeMs: 30_100, sector2TimeMs: 0, sector3TimeMs: 0, lapValidBitFlags: 0x0f },
        },
      });
    }));
    expect(st.cars[1]!.timing.confirmedLaps).toEqual([
      { lapNumber: 1, lapTimeMs: 90_000, sectorTimesMs: [30_000, 31_000, 29_000], valid: { lap: true, sectors: [true, true, true] } },
      { lapNumber: 2, lapTimeMs: 91_500, sectorTimesMs: [30_500, 31_500, 29_500], valid: { lap: true, sectors: [false, true, false] } },
    ]);
  });

  it('a car without Session History keeps none', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(2, (d) => {
      if (d.index === 1) d.add('sessionHistory', { carIdx: 1, numLaps: 1, lapHistoryData: { 0: { lapTimeInMs: 90_000 } } });
    }));
    expect(st.cars[0]!.timing.confirmedLaps).toEqual([]);
  });
});

describe('frame events', () => {
  const EXPECTED: FrameEvent[] = [
    { kind: 'overtake', carId: carId(2), otherCarId: carId(3), params: {} },
    { kind: 'collision', carId: carId(1), otherCarId: carId(4), params: {} },
    { kind: 'fastestLap', carId: carId(2), params: { lapTimeMs: 74_500 } },
    {
      kind: 'speedTrap',
      carId: carId(3),
      params: { speedKmh: 320.5, overallFastest: 1, driverFastest: 1, fastestCarId: 3, fastestSpeedKmh: 321.25 },
    },
  ];

  const run = () =>
    runScenario(
      new ScenarioBuilder({ cars: 6 })
        .event({ code: 'OVTK', overtakingVehicleIdx: 2, beingOvertakenVehicleIdx: 3 })
        .event({ code: 'COLL', vehicle1Idx: 1, vehicle2Idx: 4 })
        .event({ code: 'FTLP', vehicleIdx: 2, lapTime: 74.5 })
        .event({ code: 'SPTP', vehicleIdx: 3, speed: 320.5, isOverallFastestInSession: 1, isDriverFastestInSession: 1, fastestVehicleIdxInSession: 3, fastestSpeedInSession: 321.25 })
        // signals and BUTN are no frame events
        .event({ code: 'SSTA' })
        .event({ code: 'BUTN', buttonStatus: 1 })
        .frame(() => {}),
    );

  it("OVTK, COLL, FTLP and SPTP become the frame's FrameEvents, in order and in domain units", () => {
    expect(run().st.frameEvents).toEqual(EXPECTED);
  });

  it('they belong to their frame: the next frame starts with none', () => {
    const { st } = runScenario(
      new ScenarioBuilder({ cars: 6 }).event({ code: 'OVTK', overtakingVehicleIdx: 2, beingOvertakenVehicleIdx: 3 }).frame(() => {}).frame(() => {}),
    );
    expect(st.frameEvents).toEqual([]);
  });

  it('255 is no car', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 6 }).event({ code: 'COLL', vehicle1Idx: 1, vehicle2Idx: 255 }).frame(() => {}));
    expect(st.frameEvents).toEqual([{ kind: 'collision', carId: 1, params: {} }]);
  });
});
