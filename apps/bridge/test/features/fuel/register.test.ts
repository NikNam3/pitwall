import { describe, expect, it } from "vitest";
import { known, unknown } from "@pitwall/domain";
import type { FuelOutput } from "@pitwall/analysis";
import fuel from "../../../src/features/fuel/register.ts";

const state = (kg: number) => ({
  kg: known(kg, 1),
  burnKgPerLap: known(1.5, 1),
  lapsOfFuel: known(kg / 1.5, 1),
  lapsLeft: known(18, 1),
  marginLaps: known(2, 1),
  saveTargetKgPerLap: unknown("notApplicable"),
  gameRemainingLaps: known(20, 1),
  mix: known("standard" as const, 1),
});

describe("fuel feature", () => {
  it("registers the calculator fuel and binds fuel.car to it", () => {
    expect(fuel.name).toBe("fuel");
    expect(fuel.calculators.map((c) => c.id)).toEqual(["fuel"]);
    expect(fuel.topics).toHaveLength(1);
    expect(fuel.topics[0]).toMatchObject({
      topic: "fuel.car",
      from: "fuel",
      select: expect.any(Function),
    });
  });

  it("select returns the value for params.carId and undefined for an unknown car", () => {
    const binding = fuel.topics[0] as unknown as {
      select: (out: FuelOutput, params: object) => unknown;
    };
    const out = { 0: state(30), 5: state(12) } as unknown as FuelOutput;
    expect(binding.select(out, { carId: 0 })).toEqual(state(30));
    expect(binding.select(out, { carId: 5 })).toEqual(state(12));
    expect(binding.select(out, { carId: 7 })).toBeUndefined();
    expect(binding.select(out, {})).toBeUndefined();
  });
});
