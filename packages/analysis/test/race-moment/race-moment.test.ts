import { describe, expect, it } from "vitest";
import { carId, known, unknown } from "@pitwall/domain";
import type {
  OpenSpan,
  BattleCard,
  BattleSide,
  CarId,
  DrsStatus,
  IncidentEntry,
  Insight,
  Known,
  RaceMoment,
  SessionTime,
} from "@pitwall/domain";
import type { EngineView } from "@pitwall/engine/readers";
import { guardedView } from "../../../engine/test/support/scheduler.ts";
import {
  engineView,
  neutralisation,
  openNeutralisation,
  phaseSpans,
} from "../../../../test-support/builders/index.ts";
import { raceMomentCalculator } from "../../src/race-moment/calculator.ts";
import {
  RACE_MOMENT,
  RACE_MOMENT_CONFIG,
} from "../../src/race-moment/index.ts";
import { BATTLE, BATTLE_CONFIG } from "../../src/battle/index.ts";
import { INCIDENTS, type IncidentsOutput } from "../../src/incidents/index.ts";
import { ALARMS } from "../../src/alarms/index.ts";
import { RAIN_OUTLOOK, type RainOutlook } from "../../src/rain-outlook/index.ts";
import { RACE_MOMENT_BEHAVIOUR } from "../../src/race-moment/index.ts";
import { PIT_WINDOW, type PitWindowOutput, type PitWindowState } from "../../src/pit-window/index.ts";
import type { PitWindow } from "@pitwall/domain";

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
  where: { sector: na, turn: na, fraction: na },
  ...over,
});

// battle's side as of the live polish (spec 3.1): `margin` from PACE Δ
const side = (over: Partial<BattleSide> = {}): BattleSide => ({
  carId: car1,
  gapMs: known(5000, NOW),
  lapsToDrs: known(20, NOW),
  paceDeltaMs: known(0, NOW),
  margin: known({ kind: "pass" as const, ms: -1000 }, NOW),
  ours: { compound: "soft", age: 5 },
  theirs: { compound: "soft", age: 5 },
  theirErsStoreJ: na,
  ...over,
});

const card = (
  ahead: Known<BattleSide> = na,
  behind: Known<BattleSide> = na,
  drs: DrsStatus = { enabled: true },
): BattleCard => ({
  carId: car0,
  ahead,
  behind,
  drs,
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

/** The session-phase span open in the situation (C20): a neutralisation (SC, VSC) or a suspension (red). */
const openPhase = (kind: "SC" | "VSC" | "red", start: number, confirmed = true) =>
  openNeutralisation({ kind, start: start as SessionTime, confirmed });

/** The `rain-outlook` output (C43): its first rain sample, and whether it lies within the horizon. */
const rain = (offsetMin: number, rainPct: number, withinHorizon = true): RainOutlook => ({
  firstRain: known({ index: 0, offsetMin, rainPct }, NOW),
  withinHorizon,
});

/** The `pit-window` output (C43): our car's window state, the window's compound medium (SP4.2 spec 3.4). */
const pitWindowOf = (window: Known<PitWindowState>, car: CarId = car0): PitWindowOutput => {
  const w: PitWindow = {
    carId: car,
    flag: 50,
    currentLap: 20,
    stint: { compound: "soft", fromLap: 1, latest: known(24, NOW) },
    sets: [],
    window,
    windowCompound: window.known && window.value !== "none" ? known("medium", NOW) : na,
  };
  return { [car]: known(w, NOW) } as PitWindowOutput;
};

/** An open span of a session-scoped machine (C20). */
const openSpan = (machine: string, kind: string, detail: unknown = undefined): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start: NOW - 20_000,
  confirmed: true,
  detail,
  startFrame: 1,
});

/** The weekend phase the view's situation holds (C14): the span of `weekend-phase` and the situation's own field. */
function situationOf(kind: "race" | "practice" | "qualifying" | "none", open: OpenSpan[] = []): EngineView["situation"] {
  const byMachine: Record<string, OpenSpan[]> = { "weekend-phase": [openSpan("weekend-phase", kind)] };
  for (const span of open) (byMachine[span.machine] ??= []).push(span);
  const weekendPhase = kind === "none" ? { kind } : kind === "race" ? { kind, format: "grandPrix" } : { kind, format: "full" };
  return { weekendPhase, byMachine } as unknown as EngineView["situation"];
}

function run({
  kind = "race",
  phases = [],
  active,
  session,
  incidents,
  battle,
  alarms,
  outlook,
  pitWindow,
}: {
  kind?: "race" | "practice" | "qualifying" | "none";
  /** The other open spans of the situation, beside the weekend phase and `active`. */
  session?: OpenSpan[];
  phases?: ReturnType<typeof neutralisation>[];
  active?: ReturnType<typeof openNeutralisation>;
  incidents?: IncidentEntry[];
  battle?: Record<CarId, BattleCard>;
  alarms?: Insight[];
  outlook?: RainOutlook;
  pitWindow?: PitWindowOutput;
} = {}): Known<RaceMoment> {
  const outputs = new Map<string, unknown>();
  // the incidents output: its feed (race-moment reads `.feed`); no markers without a track file
  if (incidents) outputs.set(INCIDENTS, { feed: incidents, markers: na } satisfies IncidentsOutput);
  if (battle) outputs.set(BATTLE, battle);
  if (alarms) outputs.set(ALARMS, alarms);
  if (outlook) outputs.set(RAIN_OUTLOOK, outlook);
  if (pitWindow) outputs.set(PIT_WINDOW, pitWindow);
  const { spans, situation } = phaseSpans(phases, active, situationOf(kind, session));
  const view = engineView({
    history: { spans },
    situation,
    outputs,
    sessionTime: NOW,
  });
  // every test computes through the unit's guarded view (C41)
  return raceMomentCalculator.compute(guardedView(view, raceMomentCalculator.reads, { unit: RACE_MOMENT }));
}

const value = (out: Known<RaceMoment>): RaceMoment => {
  if (!out.known) throw new Error(`unknown: ${out.reason}`);
  return out.value;
};

describe("race-moment calculator", () => {
  it("is the quick calculator race-moment at 4 Hz reading its inputs, rain-outlook among them (C43)", () => {
    expect(raceMomentCalculator.id).toBe(RACE_MOMENT);
    expect(raceMomentCalculator.kind).toBe("quick");
    expect(raceMomentCalculator.cadence).toEqual({ hz: 4 });
    expect(raceMomentCalculator.reads).toEqual(
      expect.arrayContaining([
        "spans:weekend-phase",
        "spans:session-phase-race",
        { calculator: INCIDENTS },
        { calculator: BATTLE },
        { calculator: ALARMS },
        { calculator: RAIN_OUTLOOK },
      ]),
    );
  });

  it("reads pit-window for the window moment (C43, SP4.2 spec 3.5)", () => {
    expect(raceMomentCalculator.reads).toEqual(expect.arrayContaining([{ calculator: PIT_WINDOW }]));
    expect(raceMomentCalculator.reads).toContainEqual({ calculator: "pit-window" });
  });

  it("reads no session-phase machine of qualifying or practice: it is race only (C14, C46)", () => {
    const reads = raceMomentCalculator.reads.filter((r) => typeof r === "string") as string[];
    expect(reads).not.toContain("spans:session-phase-qualifying");
    expect(reads).not.toContain("spans:session-phase-practice");
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

    it("neutralised: an open neutralisation of the race's session phases", () => {
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

    it("neutralised: an open suspension (red flag), its kind red", () => {
      const v = value(run({ active: openPhase("red", NOW - 20_000) }));
      expect(v.moment).toBe("neutralised");
      expect(v.cause).toEqual({ rule: "flagPhase", params: { kind: "red" } });
    });

    it("neutralised: an open neutralisation still waiting for its confirmation counts (ruling 2, C18)", () => {
      const v = value(run({ active: openPhase("SC", NOW - 1_000, false) }));
      expect(v.moment).toBe("neutralised");
      expect(v.cause).toEqual({ rule: "flagPhase", params: { kind: "SC" } });
      expect(v.since).toEqual(known(NOW - 1_000, expect.anything()));
    });

    it("a closed neutralisation in the projection alone gives no neutralised moment", () => {
      const v = value(
        run({
          phases: [neutralisation({ start: NOW - 90_000, end: NOW - 30_000 })],
        }),
      );
      expect(v.moment).toBe("carCare");
    });

    it("a neutralisation closed with confirmed: false gives no neutralised moment (C18, C43)", () => {
      const v = value(
        run({
          phases: [neutralisation({ start: NOW - 4_000, end: NOW - 1_000, confirmed: false })],
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

    it("weather: rain-outlook has rain within the horizon, its first rain the cause params", () => {
      const v = value(run({ outlook: rain(5, 45) }));
      expect(v.moment).toBe("weather");
      expect(v.cause).toEqual({ rule: "forecastRain", params: { rainPct: 45, offsetMin: 5 } });
      expect(v.active).toEqual(["weather", "carCare"]);
    });

    it("weather: rain-outlook's rain beyond the horizon (withinHorizon false) sets no weather moment", () => {
      const v = value(run({ outlook: rain(5, 45, false) }));
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it("the rain thresholds are rain-outlook's: RACE_MOMENT_CONFIG has no weatherRainPct or weatherHorizonMin (C43)", () => {
      expect(Object.keys(RACE_MOMENT_CONFIG.defaults)).not.toContain("weatherRainPct");
      expect(Object.keys(RACE_MOMENT_CONFIG.defaults)).not.toContain("weatherHorizonMin");
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

    it("while DRS is off a closing car sets no battle by laps to DRS (battle gives lapsToDrs notApplicable)", () => {
      const off: DrsStatus = { enabled: false, reason: "wetTrack" };
      const closing = side({ gapMs: known(DRS + 500, NOW), lapsToDrs: na });
      const v = value(
        run({ battle: { [car0]: card(known(closing, NOW), na, off) } }),
      );
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it("while DRS is off a gap at or below drsRangeMs still sets the battle, by the gap rule", () => {
      const off: DrsStatus = { enabled: false, reason: "safetyCar" };
      const close = side({ gapMs: known(DRS, NOW), lapsToDrs: na });
      const v = value(
        run({ battle: { [car0]: card(na, known(close, NOW), off) } }),
      );
      expect(v.moment).toBe("battle");
      expect(v.cause.rule).toBe("gap");
      expect(v.cause.params).toEqual({ carId: car0, side: "behind", gapMs: DRS });
    });

    it("with PACE Δ unknown (battle gives lapsToDrs its reason) a gap at or below drsRangeMs sets the battle by the gap rule, a gap beyond it none", () => {
      const early = (gapMs: number) =>
        side({
          gapMs: known(gapMs, NOW),
          paceDeltaMs: unknown("insufficientData"),
          lapsToDrs: unknown("insufficientData"),
          margin: unknown("insufficientData"),
        });
      const v = value(
        run({ battle: { [car0]: card(known(early(DRS), NOW)) } }),
      );
      expect(v.moment).toBe("battle");
      expect(v.cause.rule).toBe("gap");
      expect(v.cause.params).toEqual({ carId: car0, side: "ahead", gapMs: DRS });
      const far = value(
        run({ battle: { [car0]: card(known(early(DRS + 1), NOW)) } }),
      );
      expect(far.moment).toBe("carCare");
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

  describe("window (SP4.2 spec 3.5): pit-window's window of one of our cars is lead or open (C43, C46)", () => {
    it("lead: window active, cause pitWindow with the car and the window compound, since notApplicable", () => {
      const v = value(run({ pitWindow: pitWindowOf(known("lead", NOW)) }));
      expect(v.moment).toBe("window");
      expect(v.cause).toEqual({ rule: "pitWindow", params: { carId: car0, compound: "medium" } });
      expect(v.since).toEqual(na);
      expect(v.active).toEqual(["window", "carCare"]);
    });

    it("open: window active", () => {
      const v = value(run({ pitWindow: pitWindowOf(known("open", NOW)) }));
      expect(v.moment).toBe("window");
      expect(v.cause).toEqual({ rule: "pitWindow", params: { carId: car0, compound: "medium" } });
      expect(v.active).toEqual(["window", "carCare"]);
    });

    it.each(["before", "closed", "none"] as const)("%s: no window moment", (state) => {
      const v = value(run({ pitWindow: pitWindowOf(known(state, NOW)) }));
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it("an unknown window: no window moment", () => {
      const v = value(run({ pitWindow: pitWindowOf(unknown("insufficientData")) }));
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it("with an incident active: incident current, window in active after it", () => {
      const v = value(run({ incidents: [incident()], pitWindow: pitWindowOf(known("open", NOW)) }));
      expect(v.moment).toBe("incident");
      expect(v.active).toEqual(["incident", "window", "carCare"]);
    });

    it("with a weather moment: window current, weather after it", () => {
      const v = value(run({ outlook: rain(5, 45), pitWindow: pitWindowOf(known("lead", NOW)) }));
      expect(v.moment).toBe("window");
      expect(v.cause).toEqual({ rule: "pitWindow", params: { carId: car0, compound: "medium" } });
      expect(v.active).toEqual(["window", "weather", "carCare"]);
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
          outlook: rain(2, 90),
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
    it("is the start of the open span when neutralised", () => {
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
      expect(value(run({ outlook: rain(1, 100) })).since).toEqual(na);
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
    it("practice, qualifying and none: notApplicable", () => {
      for (const kind of ["practice", "qualifying", "none"] as const) {
        const out = run({
          kind,
          active: openPhase("SC", NOW - 20_000),
          incidents: [incident()],
        });
        expect(out).toEqual(na);
      }
    });

    it("a race with a sprint format is the race phase: it computes", () => {
      const sprint = { ...situationOf("race"), weekendPhase: { kind: "race", format: "sprint" } } as unknown as EngineView["situation"];
      const view = engineView({ situation: sprint, sessionTime: NOW });
      const out = raceMomentCalculator.compute(guardedView(view, raceMomentCalculator.reads, { unit: RACE_MOMENT }));
      expect(out.known).toBe(true);
    });
  });

  describe("behaviour table (C44): one row per kind of weekend-phase and session-phase-race", () => {
    // a row is what race-moment computes with that span open; the weekend-phase row of the standard run is `race`
    const phaseKinds = ["grid", "formation", "startLights", "racing", "finished", "postSession"] as const;

    it("is keyed by exactly the machines the calculator reads", () => {
      expect(Object.keys(RACE_MOMENT_BEHAVIOUR).sort()).toEqual(["session-phase-race", "weekend-phase"]);
    });

    it.each(["practice", "qualifying", "none"] as const)("weekend-phase %s: notApplicable", (kind) => {
      expect(run({ kind })).toEqual(na);
    });

    it("weekend-phase pending (no span yet): notReceived, the phase is not known yet (C3, C14)", () => {
      // before the first Session packet with a weekend structure: no weekend-phase span, nothing per phase runs (C14)
      const pending = { weekendPhase: { kind: "pending" }, byMachine: {} } as unknown as EngineView["situation"];
      const view = engineView({ situation: pending, sessionTime: NOW });
      expect(raceMomentCalculator.compute(guardedView(view, raceMomentCalculator.reads, { unit: RACE_MOMENT }))).toEqual(unknown("notReceived"));
    });

    it("weekend-phase race: applicable, carCare when nothing else holds", () => {
      expect(value(run({ kind: "race" })).moment).toBe("carCare");
    });

    it.each(phaseKinds)("session-phase-race %s: no neutralised moment", (kind) => {
      const v = value(run({ session: [openSpan("session-phase-race", kind)] }));
      expect(v.moment).toBe("carCare");
      expect(v.active).toEqual(["carCare"]);
    });

    it.each(["SC", "VSC"] as const)("session-phase-race neutralised (%s): the neutralised moment, its car as the kind", (car) => {
      const v = value(run({ session: [openSpan("session-phase-race", "neutralised", { car, stages: [{ stage: "deployed", at: NOW - 20_000 }] })] }));
      expect(v.moment).toBe("neutralised");
      expect(v.cause).toEqual({ rule: "flagPhase", params: { kind: car } });
      expect(v.since).toEqual(known(NOW - 20_000, expect.anything()));
    });

    it("session-phase-race suspended: the neutralised moment, kind red", () => {
      const v = value(run({ session: [openSpan("session-phase-race", "suspended", { restart: unknown("notReceived") })] }));
      expect(v.moment).toBe("neutralised");
      expect(v.cause).toEqual({ rule: "flagPhase", params: { kind: "red" } });
    });
  });

  describe("race-moment detects no situation (C46)", () => {
    it("neutralised comes only from an open neutralised session-phase span: closed spans of the projection give none", () => {
      const closed = [
        neutralisation({ start: NOW - 90_000, end: NOW - 30_000 }),
        neutralisation({ kind: "red", start: NOW - 200_000, end: NOW - 100_000, id: 1 }),
      ];
      expect(value(run({ phases: closed })).moment).toBe("carCare");
    });

    it("neutralised comes only from an open neutralised session-phase span: a suspended span of qualifying or practice in a race gives none", () => {
      for (const machine of ["session-phase-qualifying", "session-phase-practice"]) {
        const v = value(run({ session: [openSpan(machine, "suspended", { restart: unknown("notReceived") })] }));
        expect(v.moment).toBe("carCare");
      }
    });

    it("neutralised comes only from an open neutralised session-phase span: the incidents, the forecast and the battle never set it", () => {
      const v = value(
        run({
          incidents: [incident({ kind: "neutralised" })],
          outlook: rain(1, 100),
          battle: { [car0]: card(known(side({ gapMs: known(10, NOW) }), NOW)) },
        }),
      );
      expect(v.active).not.toContain("neutralised");
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
