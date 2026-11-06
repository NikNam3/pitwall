// UI state shared by the bridge and every window (spec 7.2, 7.5, 7.7, 7.8). JSON-safe.
import type { CalibrationSource, CarId, FeedId, InsightCategory } from '@pitwall/domain';

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
  | { kind: 'calibration.choose'; feedId: FeedId; setId: string | null };
