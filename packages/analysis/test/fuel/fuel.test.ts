import { describe, expect, it } from "vitest";
import { carId, known, unknown } from "@pitwall/domain";
import type {
  CarId,
  CarState,
  Known,
  LapRecord,
  SessionTime,
  StintRecord,
} from "@pitwall/domain";
import {
  carState,
  engineView,
  lap,
} from "../../../../test-support/builders/index.ts";
import { fuelCalculator } from "../../src/fuel/calculator.ts";
import { FUEL, type FuelOutput } from "../../src/fuel/index.ts";
import {
  SESSION_REMAINING,
  type SessionRemaining,
} from "../../src/session-remaining/index.ts";

const NOW = 500_000 as SessionTime;
const car0 = carId(0);

const remaining = (
  lapsLeft: Known<number>,
  basis: SessionRemaining["basis"] = "laps",
): SessionRemaining => ({
  basis,
  lapsLeft,
  timeLeftMs: unknown("notApplicable"),
});

/** Laps `from..to` of car 0, each burning `burn` kg, the first starting at `startKg`; `completedAt` is `n * 1000`. */
function burnLaps(
  from: number,
  to: number,
  burn: number,
  startKg: number,
  over: Partial<LapRecord> = {},
): LapRecord[] {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    const at = n * 1000;
    return lap({
      lapNumber: n,
      completedAt: at,
      fuelAtStartKg: known(startKg - burn * i, at),
      fuelAtEndKg: known(startKg - burn * (i + 1), at),
      ...over,
    });
  });
}

const stint = (firstLap: number, lastLap: number): StintRecord => ({
  carId: car0,
  firstLap,
  lastLap,
  actualCompound: "C3",
  visualCompound: "soft",
  tyreAgeAtFitting: 0,
});

const fuelCar = (
  kg: number,
  extra: {
    remainingLaps?: number;
    mix?: "lean" | "standard" | "rich" | "max";
  } = {},
): CarState =>
  carState({
    id: car0,
    energy: {
      fuel: known(
        {
          kg,
          capacityKg: 110,
          remainingLaps: extra.remainingLaps ?? 20,
          mix: extra.mix ?? "standard",
        },
        7,
      ),
    },
  });

function run({
  kg,
  laps,
  stints = [stint(1, 99)],
  left = known(18, 1),
  session,
  withRemaining = true,
  car,
}: {
  kg: number;
  laps: LapRecord[];
  stints?: StintRecord[];
  left?: Known<number>;
  session?: "timeTrial" | "practice";
  withRemaining?: boolean;
  car?: CarState;
}): FuelOutput[CarId] {
  const outputs = new Map<string, unknown>();
  if (withRemaining)
    outputs.set(
      SESSION_REMAINING,
      remaining(left, session === "practice" ? "time" : "laps"),
    );
  const view = engineView({
    cars: [car ?? fuelCar(kg)],
    history: { laps, stints },
    outputs,
    sessionTime: NOW,
    ...(session && { session: { kind: session } }),
  });
  const out = fuelCalculator.compute(view);
  const state = out[car0];
  if (!state) throw new Error("no fuel state for car 0");
  return state;
}

const valueOf = (k: Known<unknown>) => (k.known ? k.value : undefined);

describe("fuel calculator", () => {
  it("is a quick calculator at 4 Hz that reads laps, stints, energy and session-remaining", () => {
    expect(fuelCalculator.id).toBe(FUEL);
    expect(fuelCalculator.kind).toBe("quick");
    expect(fuelCalculator.cadence).toEqual({ hz: 4 });
    expect(fuelCalculator.reads).toEqual(
      expect.arrayContaining([
        "laps",
        "stints",
        "energy",
        { calculator: SESSION_REMAINING },
      ]),
    );
  });

  it("burn 1.5 kg/lap, 30 kg left, 18 laps left: lapsOfFuel 20, margin +2, save target notApplicable", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      left: known(18, 1),
    });
    expect(valueOf(f.kg)).toBe(30);
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
    expect(valueOf(f.lapsOfFuel)).toBeCloseTo(20, 9);
    expect(valueOf(f.lapsLeft)).toBe(18);
    expect(valueOf(f.marginLaps)).toBeCloseTo(2, 9);
    expect(f.saveTargetKgPerLap).toEqual({
      known: false,
      reason: "notApplicable",
    });
  });

  it("30 kg, burn 1.5, 22 laps left: margin -2, save target 0.136 kg/lap", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      left: known(22, 1),
    });
    expect(valueOf(f.marginLaps)).toBeCloseTo(-2, 9);
    expect(valueOf(f.saveTargetKgPerLap)).toBeCloseTo(1.5 - 30 / 22, 9);
    expect(valueOf(f.saveTargetKgPerLap)).toBeCloseTo(0.136, 3);
  });

  it("a margin of exactly zero needs no save target", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      left: known(20, 1),
    });
    expect(valueOf(f.marginLaps)).toBeCloseTo(0, 9);
    expect(f.saveTargetKgPerLap).toEqual({
      known: false,
      reason: "notApplicable",
    });
  });

  it("a refuel or stop restarts the burn samples: only laps of the current stint count", () => {
    // laps 1-5 burn 3 kg/lap, the car stops and refuels to 110 kg, laps 6-8 of the new stint burn 1.5 kg/lap
    const laps = [...burnLaps(1, 5, 3, 100), ...burnLaps(6, 8, 1.5, 110)];
    const f = run({ kg: 30, laps, stints: [stint(1, 5), stint(6, 99)] });
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
    // one stint over all laps: the window (laps 4-8) spans the refuel, so most pairwise slopes are positive
    const single = run({ kg: 30, laps, stints: [stint(1, 99)] });
    expect(valueOf(single.burnKgPerLap)).not.toBeCloseTo(1.5, 1);
  });

  it("a new stint with fewer samples than minSamples (3) has an unknown burn, not the old stint's", () => {
    const laps = [...burnLaps(1, 5, 3, 100), ...burnLaps(6, 7, 1.5, 100)];
    const f = run({
      kg: 30,
      laps,
      stints: [stint(1, 5), stint(6, 99)],
      left: known(18, 1),
    });
    const insufficient = { known: false, reason: "insufficientData" };
    expect(f.burnKgPerLap).toEqual(insufficient);
    expect(f.lapsOfFuel).toEqual(insufficient);
    expect(f.marginLaps).toEqual(insufficient);
    expect(f.saveTargetKgPerLap).toEqual(insufficient);
    expect(valueOf(f.kg)).toBe(30);
  });

  it("too few laps in a fresh run is insufficientData", () => {
    const f = run({ kg: 30, laps: burnLaps(1, 2, 1.5, 100) });
    expect(f.burnKgPerLap).toEqual({
      known: false,
      reason: "insufficientData",
    });
  });

  it("an in lap is not a forRate lap and does not change the burn", () => {
    const laps = [
      ...burnLaps(1, 5, 1.5, 100),
      ...burnLaps(6, 6, 0.5, 92.5, { inLap: true }),
    ];
    expect(valueOf(run({ kg: 30, laps }).burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("uses the last 5 laps (the window)", () => {
    const laps = [...burnLaps(1, 5, 4, 200), ...burnLaps(6, 10, 1.5, 180)];
    expect(valueOf(run({ kg: 30, laps }).burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("time trial fuel constant at 10 kg: burn 0, margin follows lapsLeft (notApplicable in TT)", () => {
    const f = run({
      kg: 10,
      laps: burnLaps(1, 5, 0, 10),
      session: "timeTrial",
      left: unknown("notApplicable"),
    });
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(0, 9);
    const na = { known: false, reason: "notApplicable" };
    expect(f.lapsOfFuel).toEqual(na);
    expect(f.lapsLeft).toEqual(na);
    expect(f.marginLaps).toEqual(na);
    expect(f.saveTargetKgPerLap).toEqual(na);
  });

  it("a timed session (lapsLeft notApplicable): lapsOfFuel stays known, margin and save target notApplicable", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      session: "practice",
      left: unknown("notApplicable"),
    });
    expect(valueOf(f.lapsOfFuel)).toBeCloseTo(20, 9);
    expect(f.marginLaps).toEqual({ known: false, reason: "notApplicable" });
    expect(f.saveTargetKgPerLap).toEqual({
      known: false,
      reason: "notApplicable",
    });
  });

  it("session-remaining unknown: lapsLeft, margin and save target carry its reason; lapsOfFuel stays known", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      left: unknown("notReceived"),
    });
    const reason = { known: false, reason: "notReceived" };
    expect(f.lapsLeft).toEqual(reason);
    expect(f.marginLaps).toEqual(reason);
    expect(f.saveTargetKgPerLap).toEqual(reason);
    expect(valueOf(f.lapsOfFuel)).toBeCloseTo(20, 9);
  });

  it("session-remaining absent from the outputs is read as notReceived", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      withRemaining: false,
    });
    expect(f.lapsLeft).toEqual({ known: false, reason: "notReceived" });
    expect(f.marginLaps).toEqual({ known: false, reason: "notReceived" });
  });

  it("gameRemainingLaps is the car state's remainingLaps; mix is the car state's mix", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      car: fuelCar(30, { remainingLaps: 17.4, mix: "rich" }),
    });
    expect(f.gameRemainingLaps).toEqual({ known: true, value: 17.4, at: 7 });
    expect(f.mix).toEqual({ known: true, value: "rich", at: 7 });
    expect(f.kg).toEqual({ known: true, value: 30, at: 7 });
  });

  it("fuel unknown in the car state (realism): kg, lapsOfFuel, gameRemainingLaps and mix are unknown with its reason", () => {
    const hidden = carState({ id: car0, energy: { fuel: unknown("realism") } });
    const f = run({ kg: 0, laps: burnLaps(1, 5, 1.5, 100), car: hidden });
    const realism = { known: false, reason: "realism" };
    expect(f.kg).toEqual(realism);
    expect(f.lapsOfFuel).toEqual(realism);
    expect(f.gameRemainingLaps).toEqual(realism);
    expect(f.mix).toEqual(realism);
  });

  describe('the "at" of each Known', () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      left: known(22, 321),
    });
    it("burn carries the newest used lap's completion time", () => {
      expect(f.burnKgPerLap).toMatchObject({ known: true, at: 5000 });
    });
    it("lapsLeft is session-remaining's Known as it is", () => {
      expect(f.lapsLeft).toEqual({ known: true, value: 22, at: 321 });
    });
    it("lapsOfFuel, margin and save target are computed now: the view's sessionTime", () => {
      expect(f.lapsOfFuel).toMatchObject({ known: true, at: NOW });
      expect(f.marginLaps).toMatchObject({ known: true, at: NOW });
      expect(f.saveTargetKgPerLap).toMatchObject({ known: true, at: NOW });
    });
  });

  it("publishes one entry per active car, keyed by car id", () => {
    const view = engineView({
      cars: [fuelCar(30), carState({ id: carId(3) })],
      history: { laps: burnLaps(1, 5, 1.5, 100), stints: [stint(1, 99)] },
      outputs: new Map([[SESSION_REMAINING, remaining(known(18, 1))]]),
    });
    const out = fuelCalculator.compute(view);
    expect(Object.keys(out).sort()).toEqual(["0", "3"]);
  });
});
