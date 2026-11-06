// The calibration panel's rows (SP4.1a spec 6; mockup docs/design/2026-11-06-sp4.1a/calibration-panel.html). Pure: it
// picks what the topics say and formats it; every count, use, residual and skip comes from the topics (C43, C65). The
// track and the set are window-local choices of the panel (C73); the actions carry the picked track and set.
import type { UiAction } from '@pitwall/contracts';
import type {
  CalibrationActiveValue, CalibrationCandidatesValue, CalibrationSet, CalibrationSetsValue, CalibrationSource, CalibrationValuesValue,
  EstimateSource, FittedSource, Known, LapUse, SourceFit, VisualCompound,
} from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import {
  fixed, formatCount, formatDay, formatDriverCode, formatLapNumber, formatLapRange, formatLapTime, formatPct, formatSeconds,
  formatSecondsUnit, formatSigma, formatSignedSeconds, formatWeekendPhase, parseDecimal, parseSeconds,
} from '../../kit/values/format.ts';
import { sourceTitle } from '../../kit/values/source-badge.ts';
import * as text from './text.ts';

// The track and the set

/** The panel's track: the running session's, else the user's pick, else the newest stored session's (`null`: none stored). */
export function trackOf(active: CalibrationActiveValue, candidates: CalibrationCandidatesValue, picked: number | undefined): number | null {
  if (active.known) return active.value.trackId;
  return picked ?? candidates.newestTrackId;
}

/** The tracks the track picker offers: the shown one, then every track with a set, then every track with suggestions. */
export function trackOptions(shown: number | null, sets: CalibrationSetsValue, candidates: CalibrationCandidatesValue): number[] {
  const withSuggestions = Object.entries(candidates.byTrack)
    .filter(([, list]) => list.length > 0)
    .map(([id]) => Number(id));
  return [...new Set([...(shown === null ? [] : [shown]), ...sets.sets.map((s) => s.trackId), ...withSuggestions])];
}

/** The track's sets, in the topic's order. */
export const setsOf = (sets: CalibrationSetsValue, trackId: number | null): CalibrationSet[] =>
  trackId === null ? [] : sets.sets.filter((s) => s.trackId === trackId);

/** The set the race on this track runs on (`null`: defaults, or no race on this track). */
export const runningSetId = (active: CalibrationActiveValue, trackId: number | null): string | null =>
  active.known && active.value.trackId === trackId ? active.value.setId : null;

/** The shown set: the user's pick, else the running one, else the track's first. */
export const shownSet = (trackSets: readonly CalibrationSet[], picked: string | undefined, running: string | null): CalibrationSet | undefined =>
  trackSets.find((s) => s.id === picked) ?? trackSets.find((s) => s.id === running) ?? trackSets[0];

/** What the line beside the set picker says. */
export function sessionState(active: CalibrationActiveValue, setId: string | undefined, running: string | null, compact: boolean): string {
  if (!active.known) return text.noSession;
  if (setId !== undefined && setId === running) return compact ? text.activeShort : text.activeInRace;
  return compact ? text.notInRaceShort : text.notInRace;
}

// Sources and suggestions

/** A source's identity in the panel (its open state): stable across a republish, unlike its index. */
export const sourceKey = (s: CalibrationSource): string => `${s.sessionUid}/${s.weekendId}/${s.feedCar}/${s.car}/${s.firstLap}`;

/** One row of the sources or suggestions table, every cell formatted. */
export type SourceRow = {
  session: CellPart;
  date: CellPart;
  car: CellPart;
  cmp: CellPart;
  stint: string;
  laps: string;
  lapsHover: string | undefined;
  deg: CellPart;
  drift: CellPart;
  /** A skipped source: `missing` or `stale`. */
  skipped: 'missing' | 'stale' | undefined;
  /** A fitted source can be opened to its laps. */
  fitted: FittedSource | undefined;
};

const compoundLetter = (c: VisualCompound): string => COMPOUND_MARK[c].letter;
const signed3 = (ms: number): string => formatSignedSeconds(ms, 3);
const driver = (d: Known<string>): CellPart => knownPart(d, formatDriverCode);

export function sourceRow(fit: SourceFit): SourceRow {
  if (fit.skipped !== undefined) {
    return {
      session: knownPart(fit.phase, formatWeekendPhase),
      date: knownPart(fit.sessionDate, formatDay),
      car: driver(fit.driver),
      cmp: knownPart(fit.compound, compoundLetter),
      stint: formatLapRange(fit.source.firstLap),
      laps: '',
      lapsHover: undefined,
      deg: { text: '' },
      drift: { text: '' },
      skipped: fit.skipped,
      fitted: undefined,
    };
  }
  const deg = degKey(fit.compound);
  const last = fit.lapList.at(-1)?.lapNumber;
  return {
    session: { text: formatWeekendPhase(fit.phase) },
    date: { text: formatDay(fit.sessionDate) },
    car: driver(fit.driver),
    cmp: { text: compoundLetter(fit.compound) },
    stint: formatLapRange(fit.source.firstLap, last),
    laps: text.usedOf(fit.usedLaps, fit.laps),
    lapsHover: text.usedOfHover(fit.usedLaps, fit.laps),
    deg: entryPart(fit.entries[deg], signed3),
    // A suggestion has no residual against the set: it shows nothing rather than a mark.
    drift: fit.residuals[deg]?.known === true ? { text: formatSigma(fit.residuals[deg].value) } : { text: '' },
    skipped: undefined,
    fitted: fit,
  };
}

const entryPart = (v: Known<number> | undefined, format: (n: number) => string): CellPart =>
  v === undefined ? unknownPart('insufficientData') : knownPart(v, format);

/** A lap of an opened source: a toggle (kept or excluded by the user), or a lap never used, with its reason. */
export type LapCell =
  | { lapNumber: number; label: string; time: CellPart; toggle: 'kept' | 'excluded'; downWeighted: boolean }
  | { lapNumber: number; label: string; time: CellPart; toggle: undefined; reason: string };

const neverPace = (use: Known<LapUse>): string | undefined =>
  use.known && typeof use.value === 'object' ? text.neverPace[use.value.excluded] : undefined;

export function lapCell(lap: FittedSource['lapList'][number]): LapCell {
  const base = { lapNumber: lap.lapNumber, label: formatLapNumber(lap.lapNumber, 2), time: knownPart(lap.lapTimeMs, formatLapTime) };
  const reason = neverPace(lap.use);
  if (reason !== undefined) return { ...base, toggle: undefined, reason };
  return { ...base, toggle: lap.excluded ? 'excluded' : 'kept', downWeighted: lap.use.known && lap.use.value === 'downWeighted' };
}

/** The laps of an opened source in `columns` columns, top to bottom then left to right (the mockup's three). */
export function lapColumns(fit: FittedSource, columns: number): LapCell[][] {
  const cells = fit.lapList.map(lapCell);
  const perColumn = Math.ceil(cells.length / columns);
  return Array.from({ length: perColumn }, (_, row) => Array.from({ length: columns }, (_, col) => cells[col * perColumn + row]).filter((c) => c !== undefined));
}

// Values and overrides

/** How an entry shows and how its override is typed: in seconds (a key in ms) or as the number itself (a key in %). */
/** `withUnit`: the cell prints the unit (`s`, `%`) through the kit's formatter; a table's header names it otherwise. */
type Unit = { kind: 'seconds'; decimals: number; signed: boolean; withUnit: boolean } | { kind: 'percent'; decimals: number; withUnit: boolean };
/**
 * A value's cell: its priors key, its width in cells and its unit. `slot`: the cell's last cell is kept for the source
 * badge (`ᵈ` of a default), so a column's values stay aligned; without it the badge follows the cell.
 */
export type ValueSpec = { key: string; width: number; unit: Unit; slot?: true };

const S3: Unit = { kind: 'seconds', decimals: 3, signed: true, withUnit: false };
const SD: Unit = { kind: 'seconds', decimals: 3, signed: false, withUnit: false };
const WEAR: Unit = { kind: 'percent', decimals: 1, withUnit: false };

/** Priors keys, as the units declare them (`priors.ts` of degradation, tyre-life and pit-loss). */
const degKey = (c: VisualCompound): string => `degradation.nuMsPerLap.${c}`;
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** The compounds of the values table. */
export const COMPOUNDS = ['soft', 'medium', 'hard'] as const satisfies readonly VisualCompound[];
export type ValueColumn = 'offset' | 'deg' | 'sd' | (typeof CORNERS)[number];

/** A compound's row of the values table, by column. */
export const compoundSpecs = (c: VisualCompound): { column: ValueColumn; spec: ValueSpec }[] => [
  { column: 'offset', spec: { key: `degradation.alphaOffsetMs.${c}`, width: 7, unit: S3, slot: true } },
  { column: 'deg', spec: { key: degKey(c), width: 7, unit: S3, slot: true } },
  { column: 'sd', spec: { key: `degradation.nuSdMs.${c}`, width: 6, unit: SD, slot: true } },
  ...CORNERS.map((corner) => ({ column: corner, spec: { key: `tyreLife.wearPerLapPct.${c}.${corner}`, width: 4, unit: WEAR } })),
];
export const compoundLabel = compoundLetter;
/** The key whose samples a compound's N shows: its DEG/LAP's (the three keys of a compound count the same sources). */
export const samplesKey = degKey;

/** Tyre-life's two per-set limits. */
export const LIMIT_SPECS: { name: keyof typeof text.limits; spec: ValueSpec }[] = [
  { name: 'wearLimit', spec: { key: 'tyreLife.wearLimitPct', width: 4, unit: { kind: 'percent', decimals: 0, withUnit: true } } },
  { name: 'ageLossLimit', spec: { key: 'tyreLife.ageLossLimitMs', width: 7, unit: { kind: 'seconds', decimals: 3, signed: false, withUnit: true } } },
];

/** Pit loss per condition. */
export const PIT_SPECS: { condition: keyof typeof text.conditions; spec: ValueSpec }[] = (['green', 'vsc', 'sc'] as const).map((condition) => ({
  condition,
  spec: { key: `pitLoss.ms.${condition}`, width: 6, unit: { kind: 'seconds', decimals: 1, signed: false, withUnit: false }, slot: true },
}));

const formatIn = (unit: Unit, v: number): string => {
  if (unit.kind === 'percent') return unit.withUnit ? formatPct(v) : fixed(v, unit.decimals);
  if (unit.signed) return formatSignedSeconds(v, unit.decimals);
  return unit.withUnit ? formatSecondsUnit(v, unit.decimals) : formatSeconds(v, unit.decimals);
};

/** A set's values as `calibration.values` holds them. */
export type SetValues = CalibrationValuesValue['bySet'][string];

/**
 * A value cell: the set's entry formatted; for an entry no source covers, the run's default from the topic's `defaults`
 * with its `source` (the badge `ᵈ`, dim), else the kit's unknown part. `title` is the cell's hover (the default's
 * source, why it is unknown, or the set's override).
 */
export type ValueCell = { part: CellPart; title: string | undefined; source: EstimateSource | undefined };

export function valueCell(spec: ValueSpec, values: SetValues | undefined, overrides: Record<string, number>): ValueCell {
  const v = values?.entries[spec.key];
  if (v?.known === true) {
    const o = overrides[spec.key];
    return { part: { text: formatIn(spec.unit, v.value) }, title: o === undefined ? undefined : text.overrideHover(overrideText(spec, overrides)), source: undefined };
  }
  const fallback = values?.defaults[spec.key];
  if (fallback?.value.known === true) return { part: { text: formatIn(spec.unit, fallback.value.value) }, title: sourceTitle(fallback.source), source: fallback.source };
  return { part: unknownPart(v === undefined ? 'insufficientData' : v.reason), title: text.noSource, source: undefined };
}

/**
 * A key's samples (N, STOPS) as the topic counts them: the text (empty for a key whose unit declares none) and whether
 * there is none (the mockup dims such a row's label and count).
 */
export function samplesCell(key: string, values: SetValues | undefined): { text: string; none: boolean } {
  const n = values?.samples[key];
  return { text: n === undefined ? '' : formatCount(n), none: n === 0 };
}

/** The override field's text: the set's override in the unit the cell shows, or empty. */
export function overrideText(spec: ValueSpec, overrides: Record<string, number>): string {
  const o = overrides[spec.key];
  if (o === undefined) return '';
  return spec.unit.kind === 'percent' ? fixed(o, spec.unit.decimals) : formatSeconds(o, spec.unit.decimals);
}

/**
 * The action a commit of an override field sends: a number (in the unit the cell shows) sets the override in the key's
 * unit (ms, %), an empty field clears the set's override; anything else, or an empty field without an override, nothing.
 */
export function overrideAction(
  spec: ValueSpec,
  typed: string,
  at: { trackId: number; setId: string; overrides: Record<string, number> },
): UiAction | undefined {
  const { trackId, setId, overrides } = at;
  if (typed.trim() === '') {
    return overrides[spec.key] === undefined ? undefined : { kind: 'calibration.override.clear', trackId, setId, key: spec.key };
  }
  const value = spec.unit.kind === 'seconds' ? parseSeconds(typed) : parseDecimal(typed);
  return value === undefined ? undefined : { kind: 'calibration.override.set', trackId, setId, key: spec.key, value };
}

/** The compact mode's deg line: the set's DEG/LAP per compound. */
export const compactDegSpec = (c: VisualCompound): ValueSpec => ({ key: degKey(c), width: 7, unit: S3, slot: true });
