// Where an estimate's value comes from (spec 4.4): measured this session, the calibration, a driver profile, or a default.

/**
 * The source of an estimate that rests on a prior. `kind` is decided by the calculator with spec 4.4's half rule (the
 * session's share of the blend above half is `session`); the badge reads only `kind` and `parts` (C43, C65).
 * `sessionShare` is the session's share of the blend, 0..1. `parts` names what the value rests on, e.g.
 * `"3 stops + calibration"`, for the badge's hover.
 */
export type EstimateSource =
  | { kind: 'session'; sessionShare: number; parts: string }
  /** `setName`: the calibration set's name; `sources`: how many sources it pools. */
  | { kind: 'calibration'; setName: string; sources: number; sessionShare: number; parts: string }
  /** `note`: the default's source note (the track file's, or the unit's config). */
  | { kind: 'default'; note: string; sessionShare: number; parts: string }
  /** `person`: the driver profile's person (C62c); `laps`: the laps the profile entry rests on. */
  | { kind: 'profile'; person: string; laps: number; sessionShare: number; parts: string };
