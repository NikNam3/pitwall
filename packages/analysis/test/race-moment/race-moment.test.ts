import { describe, expect, it } from "vitest";
import { carId, known, unknown } from "@pitwall/domain";
import type { EngineView } from "@pitwall/engine";
import type {
  BattleCard,
  BattleSide,
  CarId,
  ForecastSample,
  IncidentEntry,
  Insight,
  Known,
  RaceMoment,
  SessionTime,
} from "@pitwall/domain";
import {
  engineView,
  flagPhase,
} from "../../../../test-support/builders/index.ts";
import { raceMomentCalculator } from "../../src/race-moment/calculator.ts";
import {
  RACE_MOMENT,
  RACE_MOMENT_CONFIG,
} from "../../src/race-moment/index.ts";
import { BATTLE, BATTLE_CONFIG } from "../../src/battle/index.ts";
import { INCIDENTS } from "../../src/incidents/index.ts";
import { ALARMS } from "../../src/alarms/index.ts";

const NOW = 600_000 as SessionTime;
const car0 = carId(0);
const car1 = carId(1);
const na = unknown("notApplicable");
const DRS = BATTLE_CONFIG.defaults.drsRangeMs;
const CFG = RACE_MOMENT_CONFIG.defaults;

const incident = (over: Partial<IncidentEntry> = {}): IncidentEntry => ({
  id: "collision:0:590000",
  at: (NOW - 10_000) as SessionTime,
  lap: 12,
  kind: "collision",
  severity: "major",
  carIds: [car1],
  timeLostMs: na,
  forUs: [],
  where: { sector: na },
  ...over,
});

const side = (over: Partial<BattleSide> = {}): BattleSide => ({
  carId: car1,
  gapMs: known(5000, NOW),
  closingMsPerLap: known(0, NOW),
  lapsToDrs: known(20, NOW),
  paceDeltaMs: known(0, NOW),
  overtakeMarginMs: known(-1000, NOW),
  ours: { compound: "soft", age: 5 },
  theirs: { compound: "soft", age: 5 },
  theirErsStoreJ: na,
  ...over,
});

const card = (
  ahead: Known<BattleSide> = na,
  behind: Known<BattleSide> = na,
): BattleCard => ({
  carId: car0,
  ahead,
  behind,
});

const alarm = (over: Partial<Insight> = {}): Insight =>
  ({
    key: "k",
    severity: "critical",
    category: "tyres",
    feedId: "test",
    carId: car0,
    kind: "tyreWear",
    params: {},
    raisedAt: 1,
    ...over,
  }) as Insight;

const openPhase = (
  kind: "SC" | "VSC" | "red",
  start: number,
): NonNullable<EngineView["activeFlagPhase"]> => ({
  kind,
  start: start as SessionTime,
  startLeaderLap: 3,
  scPhases: [],
});

const rain = (offsetMin: number, rainPct: number): ForecastSample =>
  ({
    sessionType: 15,
    offsetMin,
    weather: "lightRain",
    rainPct,
  }) as unknown as ForecastSample;

function run({
  kind = "race",
  phases = [],
  active,
  incidents,
  battle,
  alarms,
  forecast = [],
}: {
  kind?: "race" | "practice" | "qualifying";
  phases?: ReturnType<typeof flagPhase>[];
  active?: EngineView["activeFlagPhase"];
  incidents?: IncidentEntry[];
  battle?: Record<CarId, BattleCard>;
  alarms?: Insight[];
  forecast?: ForecastSample[];
} = {}): Known<RaceMoment> {
  const outputs = new Map<string, unknown>();
  if (incidents) outputs.set(INCIDENTS, incidents);
  if (battle) outputs.set(BATTLE, battle);
  if (alarms) outputs.set(ALARMS, alarms);
  const view = engineView({
    session: { kind, forecast },
    history: { flagPhases: phases },
    activeFlagPhase: active,
    outputs,
    sessionTime: NOW,
  });
  return raceMomentCalculator.compute(view);
}

const value = (out: Known<RaceMoment>): RaceMoment => {
  if (!out.known) throw new Error(`unknown: ${out.reason}`);
  return out.value;
};

describe("race-moment calculator", () => {
  it("is the quick calculator race-moment at 4 Hz reading its five inputs", () => {
    expect(raceMomentCalculator.id).toBe(RACE_MOMENT);
    expect(raceMomentCalculator.kind).toBe("quick");
    expect(raceMomentCalculator.cadence).toEqual({ hz: 4 });
    expect(raceMomentCalculator.reads).toEqual(
      expect.arrayContaining([
        "flagPhases",
        "session",
        { calculator: INCIDENTS },
        { calculator: BATTLE },
        { calculator: ALARMS },
      ]),
    );
  });

  describe("moments", () => {
    it("carCare is the default", () => {
      const v = value(run({ incidents: [], battle: {}, alarms: [] }));
      expect(v.moment).toBe("carCare");
      expect(v.cause.rule).toBe("default");
      expect(v.active).toEqual(["carCare"]);
    });

    it("missing upstream outputs give the default moment", () => {
      expect(value(run()).moment).toBe("carCare");
    });

    it("neutralised: an active flag phase", () => {
      const v = value(
        run({
          active: openPhase("VSC", NOW - 20_000),
        }),
      );
      expect(v.moment).toBe("neutralised");
      expect(v.cause.rule).toBe("flagPhase");
      expect(v.cause.params).toEqual({ kind: "VSC" });
      expect(v.active).toEqual(["neutralised", "carCare"]);
    });

    it("a closed flag phase in history alone gives no neutralised moment", () => {
      const v = value(
        run({
          phases: [flagPhase({ start: NOW - 90_000, end: NOW - 30_000 })],
        }),
      );
      expect(v.moment).toBe("carCare");
    });

    it("incident: a major incident within incidentHoldMs", () => {
      const v = value(run({ incidents: [incident()] }));
      expect(v.moment).toBe("incident");
      expect(v.cause.rule).toBe("majorIncident");
      expect(v.cause.params).toEqual({ entryId: "collision:0:590000", kind: "collision", ageMs: 10_000 });
      expect(v.active).toEqual(["incident", "carCare"]);
    });

    it("weather: a forecast sample within the horizon has rain at or above the threshold", () => {
      const v = value(run({ forecast: [rain(5, CFG.weatherRainPct)] }));
      expect(v.moment).toBe("weather");
      expect(v.cause.rule).toBe("forecastRain");
      expect(v.cause.params).toEqual({
        rainPct: CFG.weatherRainPct,
        offsetMin: 5,
      });
      expect(v.active).toEqual(["weather", "carCare"]);
    });

    it("weather ignores rain below the threshold and rain beyond the horizon", () => {
      const v = value(
        run({
          forecast: [
            rain(5, CFG.weatherRainPct - 1),
            rain(CFG.weatherHorizonMin + 1, 100),
          ],
        }),
      );
      expect(v.moment).toBe("carCare");
    });

    it("weather reads only the forecast of this session: rain forecast for another session type is ignored", () => {
      // the session is a race (sessionType 15); the game also sends the forecast of other sessions of the weekend
      const otherSession = { ...rain(5, 100), sessionType: 13 } as ForecastSample;
      expect(value(run({ forecast: [otherSession] })).moment).toBe("carCare");
      expect(value(run({ forecast: [otherSession, rain(10, CFG.weatherRainPct)] })).cause.params).toEqual({
        rainPct: CFG.weatherRainPct,
        offsetMin: 10,
      });
    });

    it("battle by laps to DRS range at or below battleLaps", () => {
      const v = value(
        run({
          battle: {
            [car0]: card(
              known(side({ lapsToDrs: known(CFG.battleLaps, NOW) }), NOW),
            ),
          },
        }),
      );
      expect(v.moment).toBe("battle");
      expect(v.cause.rule).toBe("lapsToDrs");
      expect(v.cause.params).toEqual({
        carId: car0,
        side: "ahead",
        lapsToDrs: CFG.battleLaps,
        gapMs: 5000,
      });
      expect(v.active).toEqual(["battle", "carCare"]);
    });

    it("battle by a gap at or below drsRangeMs, the car behind included", () => {
      const v = value(
        run({
          battle: {
            [car0]: card(na, known(side({ gapMs: known(DRS, NOW) }), NOW)),
          },
        }),
      );
      expect(v.moment).toBe("battle");
      expect(v.cause.rule).toBe("gap");
      expect(v.cause.params).toEqual({
        carId: car0,
        side: "behind",
        lapsToDrs: 20,
        gapMs: DRS,
      });
    });

    it("a battle card beyond both thresholds, or with unknown values, sets no battle", () => {
      const far = side({
        gapMs: known(DRS + 1, NOW),
        lapsToDrs: known(CFG.battleLaps + 1, NOW),
      });
      const unk = side({
        gapMs: unknown("notReceived"),
        lapsToDrs: unknown("notReceived"),
      });
      const v = value(
        run({ battle: { [car0]: card(known(far, NOW), known(unk, NOW)) } }),
      );
      expect(v.moment).toBe("carCare");
    });
  });

  describe("priorities and active", () => {
    it("an SC with a fresh major incident: neutralised, active [neutralised, incident, carCare]", () => {
      const v = value(
        run({
          active: openPhase("SC", NOW - 20_000),
          incidents: [incident()],
        }),
      );
      expect(v.moment).toBe("neutralised");
      expect(v.cause.rule).toBe("flagPhase");
      expect(v.active).toEqual(["neutralised", "incident", "carCare"]);
    });

    it("lists every holding moment in priority order, the current one first", () => {
      const v = value(
        run({
          incidents: [incident()],
          forecast: [rain(2, 90)],
          battle: {
            [car0]: card(known(side({ gapMs: known(300, NOW) }), NOW)),
          },
        }),
      );
      expect(v.moment).toBe("incident");
      expect(v.active).toEqual(["incident", "weather", "battle", "carCare"]);
    });
  });

  describe("incident", () => {
    it("a minor incident never sets incident", () => {
      for (const kind of ["warning", "penalty", "neutralised"] as const) {
        const v = value(
          run({ incidents: [incident({ kind, severity: "minor" })] }),
        );
        expect(v.moment).toBe("carCare");
        expect(v.active).toEqual(["carCare"]);
      }
    });

    it("incident holds for 30 s after the major entry, then falls back", () => {
      const at = (NOW - (CFG.incidentHoldMs - 1)) as SessionTime;
      expect(value(run({ incidents: [incident({ at })] })).moment).toBe(
        "incident",
      );
      const late = (NOW - (CFG.incidentHoldMs + 1)) as SessionTime;
      const v = value(run({ incidents: [incident({ at: late })] }));
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it("an old major entry does not hide a fresh one: the newest within the hold counts", () => {
      const v = value(
        run({
          incidents: [
            incident({
              id: "new",
              at: (NOW - 5_000) as SessionTime,
              kind: "retirement",
            }),
            incident({ id: "old", at: (NOW - 200_000) as SessionTime }),
          ],
        }),
      );
      // the entry the moment is about, by id: the displays light that entry, they do not pick one themselves
      expect(v.cause.params).toEqual({ entryId: "new", kind: "retirement", ageMs: 5_000 });
    });
  });

  describe("since", () => {
    it("is the flag phase start when neutralised", () => {
      const v = value(run({ active: openPhase("SC", NOW - 20_000) }));
      expect(v.since).toEqual(known(NOW - 20_000, expect.anything()));
    });

    it("is the incident time when incident", () => {
      const v = value(
        run({ incidents: [incident({ at: (NOW - 10_000) as SessionTime })] }),
      );
      expect(v.since).toEqual(known(NOW - 10_000, expect.anything()));
    });

    it("is notApplicable for weather, battle and car care", () => {
      expect(value(run({ forecast: [rain(1, 100)] })).since).toEqual(na);
      expect(
        value(
          run({
            battle: {
              [car0]: card(known(side({ gapMs: known(10, NOW) }), NOW)),
            },
          }),
        ).since,
      ).toEqual(na);
      expect(value(run()).since).toEqual(na);
    });
  });

  describe("session kinds", () => {
    it("practice and qualifying: notApplicable", () => {
      for (const kind of ["practice", "qualifying"] as const) {
        const out = run({
          kind,
          active: openPhase("SC", NOW - 20_000),
          incidents: [incident()],
        });
        expect(out).toEqual(na);
      }
    });
  });

  describe("carCare", () => {
    it("cause params carry the number of active critical alarms of our cars", () => {
      const alarms = [
        alarm({ key: "a" }),
        alarm({ key: "b", carId: car1 }),
        alarm({ key: "c", severity: "advisory" }),
        alarm({ key: "d", resolvedAt: 5 }),
      ];
      const v = value(run({ alarms }));
      expect(v.moment).toBe("carCare");
      expect(v.cause.rule).toBe("default");
      expect(v.cause.params).toEqual({ criticalAlarms: 2 });
    });

    it("is zero without alarms", () => {
      expect(value(run({ alarms: [] })).cause.params).toEqual({
        criticalAlarms: 0,
      });
    });
  });
});
