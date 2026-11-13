// Structural validation of UI state (spec 7.2). Input is untrusted: decoders return `undefined`, never throw,
// and rebuild values from the known fields only. Widget names and option values are the UI's business.
import { NOISE_COMPOUNDS, type CalibrationSource, type CarId, type FeedId, type InsightCategory, type NoiseCompound, type Policy, type SessionRef, type SessionUid, type Trigger } from '@pitwall/domain';
import type { CarRef, Geometry, LinkGroup, PanelSpec, TimeWindow, UiAction, Workbook, WorkbookWindow } from './types.ts';

type Json = Record<string, unknown>;

/** Every category, checked against the type: a category added to `InsightCategory` fails to compile until it is here. */
const CATEGORY_SET: Record<InsightCategory, true> = { strategy: true, tyres: true, energy: true, car: true, damage: true, race: true, feed: true, system: true };
const CATEGORIES: readonly string[] = Object.keys(CATEGORY_SET);

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Maps every item or gives `undefined` when one item is invalid. */
const mapAll = <R>(items: unknown, decode: (item: unknown) => R | undefined): R[] | undefined => {
  if (!Array.isArray(items)) return undefined;
  const out: R[] = [];
  for (const item of items) {
    const decoded = decode(item);
    if (decoded === undefined) return undefined;
    out.push(decoded);
  }
  return out;
};

const decodeGeometry = (raw: unknown): Geometry | undefined => {
  if (!isObject(raw) || !isNumber(raw.screen) || !isNumber(raw.x) || !isNumber(raw.y) || !isNumber(raw.width) || !isNumber(raw.height)) return undefined;
  return { screen: raw.screen, x: raw.x, y: raw.y, width: raw.width, height: raw.height };
};

const decodePanel = (raw: unknown): PanelSpec | undefined => {
  if (!isObject(raw) || !isString(raw.widget) || !isObject(raw.options) || !isNumber(raw.linkGroup)) return undefined;
  return { widget: raw.widget, options: raw.options, linkGroup: raw.linkGroup };
};

/** A window of a workbook; `layout` is kept as is. */
export const decodeWorkbookWindow = (raw: unknown): WorkbookWindow | undefined => {
  if (!isObject(raw) || !isString(raw.id) || raw.id === '' || !('layout' in raw) || !isObject(raw.panels)) return undefined;
  // No prototype, so a panel named `__proto__` is an ordinary key and is not dropped.
  const panels: Record<string, PanelSpec> = Object.create(null) as Record<string, PanelSpec>;
  for (const [key, value] of Object.entries(raw.panels)) {
    const panel = decodePanel(value);
    if (panel === undefined) return undefined;
    panels[key] = panel;
  }
  const window: WorkbookWindow = { id: raw.id, layout: raw.layout, panels };
  if (raw.geometry !== undefined) {
    const geometry = decodeGeometry(raw.geometry);
    if (geometry === undefined) return undefined;
    window.geometry = geometry;
  }
  if (raw.fontPx !== undefined) {
    if (!isNumber(raw.fontPx)) return undefined;
    window.fontPx = raw.fontPx;
  }
  return window;
};

export const decodeWorkbook = (raw: unknown): Workbook | undefined => {
  if (!isObject(raw) || !isString(raw.name)) return undefined;
  const windows = mapAll(raw.windows, decodeWorkbookWindow);
  return windows === undefined ? undefined : { name: raw.name, windows };
};

const decodeCarRef = (raw: unknown): CarRef | undefined =>
  raw === 'player' || raw === 'teammate' ? raw : isNumber(raw) ? (raw as CarId) : undefined;

const decodeTimeWindow = (raw: unknown): TimeWindow | undefined => {
  if (!isObject(raw)) return undefined;
  if (raw.kind === 'live') return { kind: 'live' };
  if (raw.kind === 'lap') return isNumber(raw.lap) ? { kind: 'lap', lap: raw.lap } : undefined;
  if (raw.kind === 'range') return isNumber(raw.from) && isNumber(raw.to) ? { kind: 'range', from: raw.from, to: raw.to } : undefined;
  return undefined;
};

export const decodeLinkGroup = (raw: unknown): LinkGroup | undefined => {
  if (!isObject(raw) || !isNumber(raw.id)) return undefined;
  const primary = decodeCarRef(raw.primary);
  const compare = mapAll(raw.compare, decodeCarRef);
  const window = decodeTimeWindow(raw.window);
  if (primary === undefined || compare === undefined || window === undefined) return undefined;
  const group: LinkGroup = { id: raw.id, primary, compare, window };
  if (raw.feedId === undefined) return group;
  return isString(raw.feedId) ? { ...group, feedId: raw.feedId as FeedId } : undefined;
};

export const decodeUiAction = (raw: unknown): UiAction | undefined => {
  if (!isObject(raw)) return undefined;
  switch (raw.kind) {
    case 'workbook.open':
    case 'workbook.saveAs':
      return isString(raw.name) ? { kind: raw.kind, name: raw.name } : undefined;
    case 'workbook.updateWindow': {
      const window = decodeWorkbookWindow(raw.window);
      return window === undefined ? undefined : { kind: raw.kind, window };
    }
    case 'linkGroup.set': {
      const group = decodeLinkGroup(raw.group);
      return group === undefined ? undefined : { kind: raw.kind, group };
    }
    case 'alert.ack':
      return isString(raw.key) ? { kind: raw.kind, key: raw.key } : undefined;
    case 'alert.ackAll': {
      const keys = mapAll(raw.keys, (key) => (isString(key) ? key : undefined));
      return keys === undefined ? undefined : { kind: raw.kind, keys };
    }
    case 'alertGroup.mute':
      return isString(raw.category) && CATEGORIES.includes(raw.category) && typeof raw.muted === 'boolean'
        ? { kind: raw.kind, category: raw.category as InsightCategory, muted: raw.muted }
        : undefined;
    case 'realism.set':
      return typeof raw.enabled === 'boolean' ? { kind: raw.kind, enabled: raw.enabled } : undefined;
    case 'calibration.set.create':
      return isInteger(raw.trackId) && isString(raw.name) ? { kind: raw.kind, trackId: raw.trackId, name: raw.name } : undefined;
    case 'calibration.set.copy':
    case 'calibration.set.rename':
      return isSetRef(raw) && isString(raw.name) ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId, name: raw.name } : undefined;
    case 'calibration.set.delete':
      return isSetRef(raw) ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId } : undefined;
    case 'calibration.source.add':
    case 'calibration.source.remove': {
      const source = decodeCalibrationSource(raw.source);
      return isSetRef(raw) && source !== undefined ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId, source } : undefined;
    }
    case 'calibration.lap.exclude':
    case 'calibration.lap.include': {
      const source = decodeCalibrationSource(raw.source);
      return isSetRef(raw) && source !== undefined && isInteger(raw.lap)
        ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId, source, lap: raw.lap }
        : undefined;
    }
    case 'calibration.override.set':
      return isSetRef(raw) && isString(raw.key) && isNumber(raw.value)
        ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId, key: raw.key, value: raw.value }
        : undefined;
    case 'calibration.override.clear':
      return isSetRef(raw) && isString(raw.key) ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId, key: raw.key } : undefined;
    case 'calibration.choose':
      // `defaults` is an explicit `null`; the bridge's pipeline resolves the set against its session's track.
      return isString(raw.feedId) && (raw.setId === null || isString(raw.setId))
        ? { kind: raw.kind, feedId: raw.feedId as FeedId, setId: raw.setId }
        : undefined;
    case 'calibration.prefer':
      // `null` clears the track's preferred set.
      return isInteger(raw.trackId) && (raw.setId === null || isString(raw.setId))
        ? { kind: raw.kind, trackId: raw.trackId, setId: raw.setId }
        : undefined;
    // The driver-profile actions (C62c): only their shape; the bridge's profile store checks persons, sessions and keys (C73).
    case 'drivers.add': {
      if (!isString(raw.displayName)) return undefined;
      const action: Extract<UiAction, { kind: 'drivers.add' }> = { kind: raw.kind, displayName: raw.displayName };
      if (raw.person !== undefined) {
        if (!isString(raw.person)) return undefined;
        action.person = raw.person;
      }
      if (raw.seat !== undefined) {
        if (!isObject(raw.seat) || !isInteger(raw.seat.team) || !isInteger(raw.seat.raceNumber)) return undefined;
        action.seat = { team: raw.seat.team, raceNumber: raw.seat.raceNumber };
      }
      return action;
    }
    case 'drivers.link':
      return isInteger(raw.team) && isInteger(raw.raceNumber) && (raw.person === null || isString(raw.person))
        ? { kind: raw.kind, team: raw.team, raceNumber: raw.raceNumber, person: raw.person }
        : undefined;
    case 'drivers.exclude':
    case 'drivers.include': {
      const session = decodeSessionRef(raw.session);
      return session !== undefined && isString(raw.person) ? { kind: raw.kind, person: raw.person, session } : undefined;
    }
    case 'drivers.override':
      return isString(raw.person) && isString(raw.key) && isNumber(raw.value) ? { kind: raw.kind, person: raw.person, key: raw.key, value: raw.value } : undefined;
    case 'drivers.override.clear':
      return isString(raw.person) && isString(raw.key) ? { kind: raw.kind, person: raw.person, key: raw.key } : undefined;
    // The plan actions (C73, C76): their shape and the ranges checkable alone; the race's laps are the bridge's check,
    // whether the plan can still be followed is `strategy`'s judgement (C43).
    case 'plan.commit': {
      const policy = decodePolicy(raw.policy);
      return isString(raw.feedId) && isCarSlot(raw.carId) && policy !== undefined
        ? { kind: raw.kind, feedId: raw.feedId as FeedId, carId: raw.carId as CarId, policy }
        : undefined;
    }
    case 'plan.clear':
      return isString(raw.feedId) && isCarSlot(raw.carId) ? { kind: raw.kind, feedId: raw.feedId as FeedId, carId: raw.carId as CarId } : undefined;
    default:
      return undefined;
  }
};

/** A stored session as a driver-profile action names it (C60's key). */
const decodeSessionRef = (raw: unknown): SessionRef | undefined => {
  if (!isObject(raw) || !isString(raw.sessionUid) || !isString(raw.weekendId) || !isInteger(raw.feedCar)) return undefined;
  return { sessionUid: raw.sessionUid as SessionUid, weekendId: raw.weekendId, feedCar: raw.feedCar as CarId };
};

const isInteger = (value: unknown): value is number => Number.isInteger(value);

/** A calibration action's set: its track and its id. Only the shape; the calibration store checks that the set exists. */
const isSetRef = (raw: Json): raw is Json & { trackId: number; setId: string } => isInteger(raw.trackId) && isString(raw.setId);

/** The car slots of the game's arrays: 0…21 (F1 25 UDP spec: 22 cars). */
const MAX_CAR_SLOT = 21;
const isCarSlot = (value: unknown): value is number => isInteger(value) && value >= 0 && value <= MAX_CAR_SLOT;

const decodeCompound = (raw: unknown): NoiseCompound | undefined =>
  isString(raw) && (NOISE_COMPOUNDS as readonly string[]).includes(raw) ? (raw as NoiseCompound) : undefined;

/** A plan's stops: whole laps of at least 1, strictly ascending, of known compounds. */
const decodeStops = (raw: unknown): Policy['stops'] | undefined => {
  const stops = mapAll(raw, (item) => {
    if (!isObject(item) || !isInteger(item.lap) || item.lap < 1) return undefined;
    const compound = decodeCompound(item.compound);
    return compound === undefined ? undefined : { lap: item.lap, compound };
  });
  if (stops === undefined) return undefined;
  return stops.every((stop, i) => i === 0 || stop.lap > (stops[i - 1]?.lap ?? 0)) ? stops : undefined;
};

const decodeBox = (raw: unknown): { box: NoiseCompound } | undefined => {
  if (!isObject(raw)) return undefined;
  const box = decodeCompound(raw.box);
  return box === undefined ? undefined : { box };
};

/** A trigger of the closed kinds (`Trigger`), with its fields. */
const decodeTrigger = (raw: unknown): Trigger | undefined => {
  if (!isObject(raw)) return undefined;
  switch (raw.kind) {
    case 'neutralised': {
      if ((raw.condition !== 'sc' && raw.condition !== 'vsc') || !isInteger(raw.fromLap) || !isInteger(raw.toLap)) return undefined;
      const action = raw.action === 'stayOut' ? 'stayOut' : decodeBox(raw.action);
      return action === undefined ? undefined : { kind: 'neutralised', condition: raw.condition, fromLap: raw.fromLap, toLap: raw.toLap, action };
    }
    case 'rain': {
      const action = decodeBox(raw.action);
      return isNumber(raw.wetnessMs) && action !== undefined ? { kind: 'rain', wetnessMs: raw.wetnessMs, action } : undefined;
    }
    case 'rivalPits':
      return isCarSlot(raw.carId) && isNumber(raw.withinMs) && (raw.action === 'cover' || raw.action === 'extend')
        ? { kind: 'rivalPits', carId: raw.carId as CarId, withinMs: raw.withinMs, action: raw.action }
        : undefined;
    case 'degradationOff': {
      const switchTo = isObject(raw.action) ? decodeStops(raw.action.switchTo) : undefined;
      return isNumber(raw.wearRateDeltaPct) && switchTo !== undefined
        ? { kind: 'degradationOff', wearRateDeltaPct: raw.wearRateDeltaPct, action: { switchTo } }
        : undefined;
    }
    case 'damage': {
      const action = decodeBox(raw.action);
      return isNumber(raw.lossMsPerLap) && action !== undefined ? { kind: 'damage', lossMsPerLap: raw.lossMsPerLap, action } : undefined;
    }
    default:
      return undefined;
  }
};

/** A plan's policy (SP4.3b spec §8.2): its stops and its triggers, rebuilt from the known fields. */
const decodePolicy = (raw: unknown): Policy | undefined => {
  if (!isObject(raw)) return undefined;
  const stops = decodeStops(raw.stops);
  const triggers = mapAll(raw.triggers, decodeTrigger);
  return stops === undefined || triggers === undefined ? undefined : { stops, triggers };
};

const decodeCalibrationSource = (raw: unknown): CalibrationSource | undefined => {
  if (!isObject(raw) || !isString(raw.sessionUid) || !isString(raw.weekendId)) return undefined;
  if (!isInteger(raw.feedCar) || !isInteger(raw.car) || !isInteger(raw.firstLap)) return undefined;
  const excludedLaps = mapAll(raw.excludedLaps, (lap) => (isInteger(lap) ? lap : undefined));
  if (excludedLaps === undefined) return undefined;
  return {
    sessionUid: raw.sessionUid as SessionUid, weekendId: raw.weekendId, feedCar: raw.feedCar as CarId, car: raw.car as CarId, firstLap: raw.firstLap, excludedLaps,
  };
};
