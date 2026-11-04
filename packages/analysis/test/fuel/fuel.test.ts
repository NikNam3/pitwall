import { describe, expect, it } from "vitest";
import { carId, known, unknown } from "@pitwall/domain";
import type { EngineView } from "@pitwall/engine";
import type {
  CarId,
  CarState,
  Known,
  LapRecord,
  SessionTime,
  StintRecord,
} from "@pitwall/domain";
import type { WeekendPhase } from "@pitwall/domain";
import {
  carState,
  lap,
} from "../../../../test-support/builders/index.ts";
import { engineShaped } from "../engine-shaped.ts";
import { guardedQuick, NONE, PRACTICE, QUALIFYING, situatedView } from "../situated.ts";
import { fuelCalculator } from "../../src/fuel/calculator.ts";
import { LAP_CLASSES_CONFIG } from "../../src/lap-classes/index.ts";
import { PER_LAP_RATE_CONFIG } from "../../src/per-lap-rate/index.ts";
import { FUEL, FUEL_BEHAVIOUR, type FuelOutput } from "../../src/fuel/index.ts";
import {
  SESSION_REMAINING,
  type SessionRemaining,
} from "../../src/session-remaining/index.ts";

const NOW = 500_000 as SessionTime;
const car0 = carId(0);

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(fuelCalculator);

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
  frame: 0,
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
  stints = [],
  left = known(18, 1),
  phase,
  withRemaining = true,
  car,
  config = {},
}: {
  kg: number;
  laps: LapRecord[];
  stints?: StintRecord[];
  left?: Known<number>;
  /** The weekend phase (C14); a race by default. */
  phase?: WeekendPhase;
  withRemaining?: boolean;
  car?: CarState;
  config?: EngineView["config"];
}): FuelOutput[CarId] {
  const outputs = new Map<string, unknown>();
  if (withRemaining)
    outputs.set(
      SESSION_REMAINING,
      remaining(left, phase !== undefined && phase.kind !== "race" ? "time" : "laps"),
    );
  const view = situatedView({
    cars: [car ?? fuelCar(kg)],
    history: { laps, stints },
    outputs,
    config,
    sessionTime: NOW,
    ...(phase && { phase }),
  });
  const out = calc.compute(view);
  const state = out[car0];
  if (!state) throw new Error("no fuel state for car 0");
  return state;
}

const valueOf = (k: Known<unknown>) => (k.known ? k.value : undefined);
const insufficient = { known: false, reason: "insufficientData" };

/** One lap of car 0 from `startKg` to `endKg`; `completedAt` is `n * 1000`. */
const fuelLap = (n: number, startKg: number, endKg: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ lapNumber: n, completedAt: n * 1000, fuelAtStartKg: known(startKg, n * 1000), fuelAtEndKg: known(endKg, n * 1000), ...over });

describe("fuel calculator", () => {
  it("is a quick calculator at 4 Hz that reads laps, energy, car-status, the weekend phase and session-remaining, not stints or the session", () => {
    expect(fuelCalculator.id).toBe(FUEL);
    expect(fuelCalculator.kind).toBe("quick");
    expect(fuelCalculator.cadence).toEqual({ hz: 4 });
    const reads = ["laps", "energy", "spans:car-status", "spans:weekend-phase", { calculator: SESSION_REMAINING }];
    expect(fuelCalculator.reads).toEqual(expect.arrayContaining(reads));
    expect(fuelCalculator.reads).toHaveLength(reads.length);
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

  it("the burn is the median of the counted laps' own burns (start minus end)", () => {
    // burns 1.5, 1.6, 1.4, 1.5, 1.7: sorted 1.4, 1.5, 1.5, 1.6, 1.7
    const laps = [fuelLap(1, 100, 98.5), fuelLap(2, 98.5, 96.9), fuelLap(3, 96.9, 95.5), fuelLap(4, 95.5, 94), fuelLap(5, 94, 92.3)];
    expect(valueOf(run({ kg: 92.3, laps }).burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("a lap's burn is its own start minus its own end: a drop between laps is in no lap", () => {
    // lap 2 starts 4 kg below lap 1's end: both laps burn 1.5 kg
    const laps = [fuelLap(1, 100, 98.5), fuelLap(2, 94.5, 93)];
    expect(valueOf(run({ kg: 93, laps }).burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("a stop without a refuel keeps the burn samples: fuel is not tied to the tyre set", () => {
    // race: laps 1-2 burn 2 kg, stop at the end of lap 3 (in lap 3, out lap 4), laps 5-6 burn 1 kg
    const laps = [
      ...burnLaps(1, 2, 2, 100),
      fuelLap(3, 96, 94, { inLap: true }),
      fuelLap(4, 94, 92, { outLap: true }),
      ...burnLaps(5, 6, 1, 92),
    ];
    // the closed stint has its record; the burns of both stints count: median of 2, 2, 1, 1
    const f = run({ kg: 90, laps, stints: [stint(1, 3)] });
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("a refuel at a stop does not restart the burn samples: the laps before it stay in the window", () => {
    // laps 1-3 burn 3 kg/lap, the car stops after lap 4 and leaves with 110 kg, laps 6-7 burn 1.5 kg/lap:
    // the in and out laps are no samples, the median of 3, 3, 3, 1.5, 1.5 is 3
    const laps = [
      ...burnLaps(1, 3, 3, 100),
      fuelLap(4, 91, 88, { inLap: true }),
      fuelLap(5, 110, 108, { outLap: true }),
      ...burnLaps(6, 7, 1.5, 108),
    ];
    expect(valueOf(run({ kg: 105, laps, stints: [stint(1, 4)] }).burnKgPerLap)).toBeCloseTo(3, 9);
  });

  it("a lap on which fuel was added is no sample: a refuel never counts as negative burn", () => {
    // practice: the in lap 3 runs through the garage, which refuels from 97 to 110 kg before the lap ends
    const laps = [...burnLaps(1, 2, 1.5, 100), fuelLap(3, 97, 110, { inLap: true }), ...burnLaps(4, 5, 1.5, 110)];
    const f = run({ kg: 107, laps, phase: PRACTICE, left: unknown("notApplicable") });
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
  });

  it("a lap with 2 s or more under SC or VSC is no sample, and its low burn does not pull the burn down", () => {
    // lap 1 green 2 kg, laps 2-3 neutralised 0.5 kg each, laps 4-5 green 2 kg
    const laps = [
      fuelLap(1, 100, 98),
      fuelLap(2, 98, 97.5, { scShare: 1 }),
      fuelLap(3, 97.5, 97, { vscShare: 0.5 }),
      fuelLap(4, 97, 95),
      fuelLap(5, 95, 93),
    ];
    expect(valueOf(run({ kg: 93, laps }).burnKgPerLap)).toBeCloseTo(2, 9);
  });

  it("a lap with under 2 s under SC (the flag lag at a restart) is a sample", () => {
    // lap 2 is green but for 0.9 s: scShare 0.01 of the builder's 90 s lap
    const laps = [fuelLap(1, 100, 98), fuelLap(2, 98, 96, { scShare: 0.01 })];
    expect(valueOf(run({ kg: 96, laps }).burnKgPerLap)).toBeCloseTo(2, 9);
    const strict = run({ kg: 96, laps, config: { [LAP_CLASSES_CONFIG.key]: { maxNeutralisedMs: 500 } } });
    expect(strict.burnKgPerLap).toEqual(insufficient);
  });

  it("a lap whose start or end fuel is unknown is no sample", () => {
    const joined = fuelLap(1, 0, 98, { fuelAtStartKg: unknown("notReceived") });
    expect(run({ kg: 96, laps: [joined, fuelLap(2, 98, 96)] }).burnKgPerLap).toEqual(insufficient);
    const noEnd = fuelLap(2, 98, 0, { fuelAtEndKg: unknown("notReceived") });
    expect(run({ kg: 94, laps: [fuelLap(1, 100, 98), noEnd, fuelLap(3, 96, 94)] }).burnKgPerLap).toMatchObject({ known: true, value: 2 });
    expect(run({ kg: 96, laps: [fuelLap(1, 100, 98), noEnd] }).burnKgPerLap).toEqual(insufficient);
  });

  it("one outlier lap among 5 leaves the burn at the other laps'", () => {
    const laps = [fuelLap(1, 100, 98.3), fuelLap(2, 98.3, 96.6), fuelLap(3, 96.6, 90), fuelLap(4, 90, 88.3), fuelLap(5, 88.3, 86.6)];
    expect(valueOf(run({ kg: 86.6, laps }).burnKgPerLap)).toBeCloseTo(1.7, 9);
  });

  it("the minimum of samples comes from the per-lap-rate config", () => {
    const strict = run({ kg: 97, laps: burnLaps(1, 2, 1.5, 100), config: { [PER_LAP_RATE_CONFIG.key]: { minSamples: 3 } } });
    expect(strict.burnKgPerLap).toEqual(insufficient);
  });

  describe("on engine-shaped history: every lap provisional then confirmed, no record for the open stint", () => {
    it("a lap counts once: one lap, written twice, is below minSamples (2)", () => {
      const f = run({ kg: 30, laps: engineShaped(burnLaps(1, 1, 1.5, 100)) });
      expect(f.burnKgPerLap).toEqual(insufficient);
    });

    it("the confirmed record wins over the provisional one", () => {
      const laps = engineShaped(burnLaps(1, 5, 1.5, 100), { fuelAtEndKg: known(0, 1) });
      expect(valueOf(run({ kg: 30, laps }).burnKgPerLap)).toBeCloseTo(1.5, 9);
    });
  });

  it("one lap in a fresh run is insufficientData; two give a burn", () => {
    expect(run({ kg: 30, laps: burnLaps(1, 1, 1.5, 100) }).burnKgPerLap).toEqual(insufficient);
    expect(valueOf(run({ kg: 30, laps: burnLaps(1, 2, 1.5, 100) }).burnKgPerLap)).toBeCloseTo(1.5, 9);
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

  it("a timed session (lapsLeft notApplicable): lapsOfFuel stays known, margin and save target notApplicable", () => {
    const f = run({
      kg: 30,
      laps: burnLaps(1, 5, 1.5, 100),
      phase: PRACTICE,
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

  it("publishes one entry per car in the session, keyed by car id", () => {
    const view = situatedView({
      cars: [fuelCar(30), carState({ id: carId(3) }), carState({ id: carId(5) })],
      history: { laps: burnLaps(1, 5, 1.5, 100) },
      outputs: new Map([[SESSION_REMAINING, remaining(known(18, 1))]]),
      status: { 5: "absent" },
    });
    const out = calc.compute(view);
    expect(Object.keys(out).sort()).toEqual(["0", "3"]);
  });

  describe("behaviour table (C44): a row per weekend-phase and car-status kind", () => {
    it("exports FUEL_BEHAVIOUR over the weekend phase and car-status (laps by activity come from the lap records)", () => {
      expect(Object.keys(FUEL_BEHAVIOUR).sort()).toEqual(["car-status", "weekend-phase"]);
    });

    const na = { known: false, reason: "notApplicable" };
    const burning = { kg: 30, laps: burnLaps(1, 5, 1.5, 100) };

    it("weekend phase race: the burn over the race's laps, and the margin against session-remaining's laps left", () => {
      const f = run({ ...burning, left: known(18, 1) });
      expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
      expect(valueOf(f.marginLaps)).toBeCloseTo(2, 9);
    });

    it("weekend phase practice: the burn as in the race; a timed session's laps left leave margin and save target notApplicable", () => {
      const f = run({ ...burning, phase: PRACTICE, left: unknown("notApplicable") });
      expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
      expect(valueOf(f.lapsOfFuel)).toBeCloseTo(20, 9);
      expect(f.marginLaps).toEqual(na);
    });

    it("weekend phase qualifying: the burn as in the race", () => {
      const f = run({ ...burning, phase: QUALIFYING, left: unknown("notApplicable") });
      expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
      expect(valueOf(f.lapsOfFuel)).toBeCloseTo(20, 9);
    });

    it("weekend phase none (a time trial, C14): burn, laps of fuel, margin and save target notApplicable; the readings stay", () => {
      const f = run({ ...burning, phase: NONE, left: unknown("notApplicable"), car: fuelCar(30, { remainingLaps: 17.4, mix: "rich" }) });
      expect(f.burnKgPerLap).toEqual(na);
      expect(f.lapsOfFuel).toEqual(na);
      expect(f.marginLaps).toEqual(na);
      expect(f.saveTargetKgPerLap).toEqual(na);
      expect(f.lapsLeft).toEqual(na);
      expect(f.kg).toEqual({ known: true, value: 30, at: 7 });
      expect(f.gameRemainingLaps).toEqual({ known: true, value: 17.4, at: 7 });
      expect(f.mix).toEqual({ known: true, value: "rich", at: 7 });
    });

    // the live state's transitional `active` says the opposite of car-status in every case, so only car-status decides (C43)
    const statusRun = (kind: string, active: boolean) =>
      calc.compute(
        situatedView({
          cars: [{ ...fuelCar(30), active }],
          history: { laps: burnLaps(1, 5, 1.5, 100) },
          outputs: new Map([[SESSION_REMAINING, remaining(known(18, 1))]]),
          sessionTime: NOW,
          status: { 0: kind },
        }),
      )[car0];

    it("car-status competing: the car has its fuel state", () => {
      expect(valueOf(statusRun("competing", false)?.burnKgPerLap ?? unknown("notReceived"))).toBeCloseTo(1.5, 9);
    });

    it("car-status retired: the car is still in the session and keeps its fuel state", () => {
      expect(valueOf(statusRun("retired", false)?.burnKgPerLap ?? unknown("notReceived"))).toBeCloseTo(1.5, 9);
    });

    it("car-status disqualified: the car is still in the session and keeps its fuel state", () => {
      expect(valueOf(statusRun("disqualified", false)?.burnKgPerLap ?? unknown("notReceived"))).toBeCloseTo(1.5, 9);
    });

    it("car-status absent: no entry, though the slot has laps and the live state calls it active", () => {
      expect(statusRun("absent", true)).toBeUndefined();
    });
  });
});

describe("fuel burn in practice", () => {
  it("a lap restarted at the line after a garage refuel (neither in nor out lap) gives its own post-refuel burn only", () => {
    // lap 1 burns 1.5 kg from 30 kg; the car goes to the garage, is refuelled to 100 kg, and the engine restarts its
    // lap at the line: lap 2 has no in or out flag and runs 100 to 98.5 kg. The rise to 100 kg is in no lap, so the
    // samples are 1.5 and 1.5, not a restart (one sample: too few) and not a negative burn
    const laps = [fuelLap(1, 30, 28.5), fuelLap(2, 100, 98.5)];
    const f = run({ kg: 98.5, laps, phase: PRACTICE, left: unknown("notApplicable") });
    expect(valueOf(f.burnKgPerLap)).toBeCloseTo(1.5, 9);
    // on engine-shaped history too: each lap provisional then confirmed
    const shaped = run({ kg: 98.5, laps: engineShaped(laps), phase: PRACTICE, left: unknown("notApplicable") });
    expect(valueOf(shaped.burnKgPerLap)).toBeCloseTo(1.5, 9);
  });
});
