import { describe, expect, it } from "vitest";
import raceMoment from "../../../src/features/race-moment/register.ts";

describe("race-moment feature", () => {
  it("registers the calculator race-moment and binds raceMoment.current to it without select", () => {
    expect(raceMoment.name).toBe("race-moment");
    expect(raceMoment.calculators.map((c) => c.id)).toEqual(["race-moment"]);
    expect(raceMoment.topics).toHaveLength(1);
    expect(raceMoment.topics[0]).toMatchObject({
      topic: "raceMoment.current",
      from: "race-moment",
    });
    expect(raceMoment.topics[0]).not.toHaveProperty("select");
  });
});
