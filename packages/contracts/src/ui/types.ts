// UI state shared by the bridge and every window (spec 7.2, 7.5, 7.7, 7.8). JSON-safe.
import type { CalibrationSource, CarId, FeedId, InsightCategory, PersonId, Policy, SessionRef, TeamId } from '@pitwall/domain';

export type WindowId = string;
export type Geometry = { screen: number; x: number; y: number; width: number; height: number };
/** One widget in a window. The bridge keeps `widget` and `options` opaque; the UI validates them. */
export type PanelSpec = { widget: string; options: Record<string, unknown>; linkGroup: number };
export type WorkbookWindow = { id: WindowId; geometry?: Geometry; fontPx?: number; layout: unknown; panels: Record<string, PanelSpec> };
export type Workbook = { name: string; windows: WorkbookWindow[] };
export type CarRef = 'player' | 'teammate' | CarId;
export type TimeWindow = { kind: 'live' } | { kind: 'lap'; lap: number } | { kind: 'range'; from: number; to: number };
export type LinkGroup = { id: number; feedId?: FeedId; primary: CarRef; compare: CarRef[]; window: TimeWindow };

/** Every change to the UI state goes through one of these (spec 7.2). */
export type UiAction =
  | { kind: 'workbook.open'; name: string }
  | { kind: 'workbook.saveAs'; name: string }
  | { kind: 'workbook.updateWindow'; window: WorkbookWindow }
  | { kind: 'linkGroup.set'; group: LinkGroup }
  /** `key`/`keys` are occurrence tokens (`ackToken`), not bare insight keys. */
  | { kind: 'alert.ack'; key: string }
  | { kind: 'alert.ackAll'; keys: string[] }
  | { kind: 'alertGroup.mute'; category: InsightCategory; muted: boolean }
  | { kind: 'realism.set'; enabled: boolean }
  // Calibration (C62a, spec 3.1): the bridge validates each against the set's track and the stored sessions and rejects
  // an invalid one with a reason (C73).
  | { kind: 'calibration.set.create'; trackId: number; name: string }
  | { kind: 'calibration.set.copy'; trackId: number; setId: string; name: string }
  | { kind: 'calibration.set.rename'; trackId: number; setId: string; name: string }
  | { kind: 'calibration.set.delete'; trackId: number; setId: string }
  | { kind: 'calibration.source.add' | 'calibration.source.remove'; trackId: number; setId: string; source: CalibrationSource }
  | { kind: 'calibration.lap.exclude' | 'calibration.lap.include'; trackId: number; setId: string; source: CalibrationSource; lap: number }
  /** `value` within the key's declared range (`PriorDecl.range`). */
  | { kind: 'calibration.override.set'; trackId: number; setId: string; key: string; value: number }
  | { kind: 'calibration.override.clear'; trackId: number; setId: string; key: string }
  /** A calibration-chosen decision for the feed's run (C76); `setId` `null` chooses `defaults`. */
  | { kind: 'calibration.choose'; feedId: FeedId; setId: string | null }
  /** Marks `setId` the track's preferred set (the preselection at session start) and clears the others; `null` clears it. No decision (C62a, C75). */
  | { kind: 'calibration.prefer'; trackId: number; setId: string | null }
  // Driver profiles (C62c, SP4.3a spec 4): the bridge's profile module validates each against the persons, the stored
  // sessions and the entries' declarations and rejects an invalid one with a reason (C73); a change takes effect at the
  // next session start (C75).
  /**
   * A new person: `person` kebab-case (its file name), derived by the bridge from `displayName` when absent; with `seat`
   * the bridge links the seat to the new person in the same change.
   */
  | { kind: 'drivers.add'; displayName: string; person?: PersonId; seat?: { team: TeamId; raceNumber: number } }
  /** Links a seat (team and race number) to `person` for every stored session; `null` unlinks the seat (C62c). */
  | { kind: 'drivers.link'; team: TeamId; raceNumber: number; person: PersonId | null }
  | { kind: 'drivers.exclude'; person: PersonId; session: SessionRef }
  /** Undoes `drivers.exclude`. */
  | { kind: 'drivers.include'; person: PersonId; session: SessionRef }
  /** `value` within the entry's declared range (`ProfileEntryDecl.range`). */
  | { kind: 'drivers.override'; person: PersonId; key: string; value: number }
  | { kind: 'drivers.override.clear'; person: PersonId; key: string }
  // Plans (C76, SP4.3b spec §8.2): a plan decision for one of our cars, for every feed of the team; the bridge checks
  // shape and range only (C73), whether the plan can still be followed is the `strategy` job's judgement (C43).
  /** Commits `policy` for `carId`, its triggers with their thresholds as the user saw them. */
  | { kind: 'plan.commit'; feedId: FeedId; carId: CarId; policy: Policy }
  | { kind: 'plan.clear'; feedId: FeedId; carId: CarId };

/** The driver-profile uiActions (C62c), for the CLI's and the driver-profile panel's edits; answered as every uiAction (`ActionOutcome`, C73). */
export type DriverAction = Extract<UiAction, { kind: `drivers.${string}` }>;
