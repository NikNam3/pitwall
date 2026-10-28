// Structural validation of UI state (spec 7.2). Input is untrusted: decoders return `undefined`, never throw,
// and rebuild values from the known fields only. Widget names and option values are the UI's business.
import type { CarId, FeedId, InsightCategory } from '@pitwall/domain';
import type { CarRef, Geometry, LinkGroup, PanelSpec, TimeWindow, UiAction, Workbook, WorkbookWindow } from './types.ts';

type Json = Record<string, unknown>;

const CATEGORIES: readonly string[] = ['strategy', 'tyres', 'energy', 'damage', 'race', 'feed', 'system'] satisfies InsightCategory[];

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
  const panels: Record<string, PanelSpec> = {};
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
    default:
      return undefined;
  }
};
