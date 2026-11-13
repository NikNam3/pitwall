// A track file (C62b, spec 3.1): one per track id in `data/tracks/<trackId>.json`, committed, produced outside pitwall.
// Every lap position is a lap fraction: the game's track length and coordinate frame differ from the real track's, so
// a fraction times the session's `trackLengthM` is the game's lap distance. Every part is `Known`, so a file carries
// only what exists for its track.
import type { Known } from './known.ts';
import type { Metres, Ms } from './units.ts';

/** A position on the lap, in `[0, 1)`; times the session's `trackLengthM` it is the game's lap distance. */
export type LapFraction = number;

/** A point of the track map: in the unit square, y down, rotated for display. */
export type MapPoint = { x: number; y: number };

/** A turn of the track: its number, an optional letter (`9a`), the label shown, and its apex on the lap. */
export type TrackTurn = { number: number; letter?: string; label: string; apex: LapFraction };

/** A braking zone on the lap; it may wrap past the line (`start > end`). */
export type BrakingZone = { start: LapFraction; end: LapFraction };

/** A default a run starts from, with where it came from (`"OpenF1, 2025 <event> R, median of n stops"`). */
export type TrackDefault<T> = { value: T; source: string };

/** A track's chances of an SC or a VSC (SP4.3b spec §5.1), from real races. */
export type TrackHazard = {
  /** Real races behind the numbers. */
  races: number;
  /** The chance an SC or a VSC starts on lap 1. */
  lapOne: { sc: number; vsc: number };
  /** The chance per lap that one starts, from lap 2, by race-distance fraction; ascending `upTo`, the last 1. */
  byFraction: { upTo: number; sc: number; vsc: number }[];
  /** The chance of a neutralisation lasting 1, 2, 3 … laps (index 0 = 1 lap); each sums to 1. */
  durationLaps: { sc: number[]; vsc: number[] };
};

/** A track's data as the view holds it (`view.track`): the file without its provenance. */
export type TrackData = {
  trackId: number;
  name: string;
  realLengthM: Known<Metres>;
  /** 500 points at equal lap fractions; point i at i/500. */
  outline: Known<MapPoint[]>;
  /** In lap order. */
  turns: Known<TrackTurn[]>;
  /** In lap order, disjoint; a zone may wrap past the line (start > end). */
  brakingZones: Known<BrakingZone[]>;
  /** In lap order, by lap fraction (as braking zones); a zone may wrap past the line (start > end). `detection`: where the gap to the car ahead is measured. */
  drsZones: Known<{ detection: LapFraction; start: LapFraction; end: LapFraction }[]>;
  defaults: {
    pitLossMs: { green: Known<TrackDefault<Ms>>; vsc: Known<TrackDefault<Ms>>; sc: Known<TrackDefault<Ms>> };
    /** The in-lap's share of a green stop's loss, in [0, 1] (the rest on the out-lap; SP4.3b Q5 A). A file without it reads as `unknown('notReceived')`. */
    pitLossInLapShare: Known<TrackDefault<number>>;
    /** Relative to medium = 0. */
    compoundOffsetsMs: Known<TrackDefault<{ soft: Ms; medium: Ms; hard: Ms }>>;
    /** The SC and VSC chances (SP4.3b spec §5.1). */
    hazard: Known<TrackDefault<TrackHazard>>;
  };
};

/** The file as committed and as the sidecar: the data plus its provenance. */
export type TrackFile = TrackData & {
  source: { generator: string; sources: string; season: number; generatedOn: string };
};

const REASONS = ['restricted', 'notReceived', 'notApplicable', 'realism', 'insufficientData'];
const OUTLINE_POINTS = 500;

type Errors = string[];
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks `json` is a well-formed `Known`; when known, hands its value to `check`. */
function checkKnown(json: unknown, path: string, errors: Errors, check: (value: unknown, path: string) => void): void {
  if (!isRec(json)) return void errors.push(`${path}: not an object`);
  if (json.known === true) {
    if (!('value' in json)) errors.push(`${path}.value: missing`);
    else check(json.value, `${path}.value`);
    if (!isNum(json.at)) errors.push(`${path}.at: not a number`);
  } else if (json.known === false) {
    if (typeof json.reason !== 'string' || !REASONS.includes(json.reason)) errors.push(`${path}.reason: not an unknown reason`);
  } else errors.push(`${path}.known: not a boolean`);
}

function checkFraction(v: unknown, path: string, errors: Errors): void {
  if (!isFraction(v)) errors.push(`${path}: not a lap fraction in [0, 1)`);
}

function checkDefault(value: unknown, path: string, errors: Errors, check: (v: unknown, path: string) => void): void {
  if (!isRec(value)) return void errors.push(`${path}: not an object`);
  check(value.value, `${path}.value`);
  if (typeof value.source !== 'string') errors.push(`${path}.source: not a string`);
}

const checkMs = (errors: Errors) => (v: unknown, path: string) => {
  if (!isInt(v)) errors.push(`${path}: not an integer Ms`);
};

function checkOutline(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value)) return void errors.push(`${path}: not an array`);
  if (value.length !== OUTLINE_POINTS) errors.push(`${path}: ${value.length} points, expected ${OUTLINE_POINTS}`);
  value.forEach((p, i) => {
    if (!isRec(p) || !isNum(p.x) || !isNum(p.y)) errors.push(`${path}[${i}]: not a point { x, y }`);
  });
}

function checkTurns(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value)) return void errors.push(`${path}: not an array`);
  let previous = -1;
  value.forEach((t, i) => {
    const at = `${path}[${i}]`;
    if (!isRec(t)) return void errors.push(`${at}: not an object`);
    if (!isInt(t.number)) errors.push(`${at}.number: not an integer`);
    if (t.letter !== undefined && typeof t.letter !== 'string') errors.push(`${at}.letter: not a string`);
    if (typeof t.label !== 'string') errors.push(`${at}.label: not a string`);
    checkFraction(t.apex, `${at}.apex`, errors);
    if (isFraction(t.apex)) {
      if (t.apex < previous) errors.push(`${at}.apex: turns are not in lap order`);
      previous = t.apex;
    }
  });
}

function checkZones(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value)) return void errors.push(`${path}: not an array`);
  const zones: { start: number; end: number; at: string }[] = [];
  value.forEach((z, i) => {
    const at = `${path}[${i}]`;
    if (!isRec(z)) return void errors.push(`${at}: not an object`);
    checkFraction(z.start, `${at}.start`, errors);
    checkFraction(z.end, `${at}.end`, errors);
    if (isFraction(z.start) && isFraction(z.end)) zones.push({ start: z.start, end: z.end, at });
  });
  zones.forEach((z, i) => {
    const next = zones[i + 1];
    if (z.start > z.end && next) errors.push(`${z.at}: only the last zone may wrap past the line`);
    if (next && !(z.end < next.start)) errors.push(`${next.at}: zones are not disjoint in lap order`);
  });
  const first = zones[0];
  const last = zones.at(-1);
  if (first && last && last.start > last.end && zones.length > 1 && !(last.end < first.start)) {
    errors.push(`${last.at}: the wrapping zone overlaps the first zone`);
  }
}

function checkDrsZones(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value)) return void errors.push(`${path}: not an array`);
  value.forEach((z, i) => {
    const at = `${path}[${i}]`;
    if (!isRec(z)) return void errors.push(`${at}: not an object`);
    for (const k of ['detection', 'start', 'end']) checkFraction(z[k], `${at}.${k}`, errors);
  });
}

const PMF_TOLERANCE = 1e-9;
const isChance = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;

function checkChances(value: unknown, path: string, errors: Errors): void {
  if (!isRec(value)) return void errors.push(`${path}: not an object`);
  for (const k of ['sc', 'vsc']) {
    if (!isChance(value[k])) errors.push(`${path}.${k}: not a chance in [0, 1]`);
  }
}

function checkPmf(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value) || value.length === 0) return void errors.push(`${path}: not a non-empty array`);
  value.forEach((p, i) => {
    if (!isChance(p)) errors.push(`${path}[${i}]: not a chance in [0, 1]`);
  });
  if (value.every(isChance) && Math.abs(value.reduce((a: number, b: number) => a + b, 0) - 1) > PMF_TOLERANCE) {
    errors.push(`${path}: does not sum to 1`);
  }
}

/** Checks a `TrackHazard`: races a whole number ≥ 1, chances in `[0, 1]`, `upTo` strictly ascending ending at 1, each pmf summing to 1. */
function checkHazard(value: unknown, path: string, errors: Errors): void {
  if (!isRec(value)) return void errors.push(`${path}: not an object`);
  if (!isInt(value.races) || value.races < 1) errors.push(`${path}.races: not an integer ≥ 1`);
  checkChances(value.lapOne, `${path}.lapOne`, errors);
  const bins = value.byFraction;
  if (!Array.isArray(bins) || bins.length === 0) errors.push(`${path}.byFraction: not a non-empty array`);
  else {
    let previous = 0;
    bins.forEach((b, i) => {
      const at = `${path}.byFraction[${i}]`;
      if (!isRec(b)) return void errors.push(`${at}: not an object`);
      checkChances(b, at, errors);
      if (!isNum(b.upTo) || b.upTo <= previous || b.upTo > 1) errors.push(`${at}.upTo: not ascending in (0, 1]`);
      else previous = b.upTo;
    });
    const last = bins.at(-1);
    if (!isRec(last) || last.upTo !== 1) errors.push(`${path}.byFraction: the last upTo is not 1`);
  }
  const durations = value.durationLaps;
  if (!isRec(durations)) errors.push(`${path}.durationLaps: not an object`);
  else for (const k of ['sc', 'vsc']) checkPmf(durations[k], `${path}.durationLaps.${k}`, errors);
}

/** Checks parsed JSON against `TrackFile`: every part's shape, every lap fraction in `[0, 1)`, every `Ms` an integer, the hazard's chances and pmfs. */
export function validateTrackFile(json: unknown): { ok: true; file: TrackFile } | { ok: false; errors: string[] } {
  const errors: Errors = [];
  if (!isRec(json)) return { ok: false, errors: ['$: not an object'] };
  if (!isInt(json.trackId)) errors.push('trackId: not an integer');
  if (typeof json.name !== 'string') errors.push('name: not a string');
  checkKnown(json.realLengthM, 'realLengthM', errors, (v, p) => {
    if (!isNum(v) || v <= 0) errors.push(`${p}: not a positive length`);
  });
  checkKnown(json.outline, 'outline', errors, (v, p) => checkOutline(v, p, errors));
  checkKnown(json.turns, 'turns', errors, (v, p) => checkTurns(v, p, errors));
  checkKnown(json.brakingZones, 'brakingZones', errors, (v, p) => checkZones(v, p, errors));
  checkKnown(json.drsZones, 'drsZones', errors, (v, p) => checkDrsZones(v, p, errors));

  const defaults = json.defaults;
  if (!isRec(defaults)) errors.push('defaults: not an object');
  else {
    const loss = defaults.pitLossMs;
    if (!isRec(loss)) errors.push('defaults.pitLossMs: not an object');
    else {
      for (const k of ['green', 'vsc', 'sc']) {
        checkKnown(loss[k], `defaults.pitLossMs.${k}`, errors, (v, p) => checkDefault(v, p, errors, checkMs(errors)));
      }
    }
    if (defaults.pitLossInLapShare !== undefined) {
      checkKnown(defaults.pitLossInLapShare, 'defaults.pitLossInLapShare', errors, (v, p) =>
        checkDefault(v, p, errors, (share, sp) => {
          if (!isNum(share) || share < 0 || share > 1) errors.push(`${sp}: not a share in [0, 1]`);
        }),
      );
    }
    checkKnown(defaults.compoundOffsetsMs, 'defaults.compoundOffsetsMs', errors, (v, p) =>
      checkDefault(v, p, errors, (offsets, op) => {
        if (!isRec(offsets)) return void errors.push(`${op}: not an object`);
        for (const c of ['soft', 'medium', 'hard']) checkMs(errors)(offsets[c], `${op}.${c}`);
      }),
    );
    checkKnown(defaults.hazard, 'defaults.hazard', errors, (v, p) =>
      checkDefault(v, p, errors, (h, hp) => checkHazard(h, hp, errors)),
    );
  }

  const source = json.source;
  if (!isRec(source)) errors.push('source: not an object');
  else {
    for (const k of ['generator', 'sources', 'generatedOn']) {
      if (typeof source[k] !== 'string') errors.push(`source.${k}: not a string`);
    }
    if (!isInt(source.season)) errors.push('source.season: not an integer');
  }

  if (errors.length > 0) return { ok: false, errors };
  const file = json as TrackFile;
  // a file made before the in-lap share (SP4.3b Q5 A): the share is not received
  if ((file.defaults as Partial<TrackFile['defaults']>).pitLossInLapShare === undefined) {
    return { ok: true, file: { ...file, defaults: { ...file.defaults, pitLossInLapShare: { known: false, reason: 'notReceived' } } } };
  }
  return { ok: true, file };
}

/** The file's data without its provenance (`source`), as `view.track` holds it (C35). */
export function trackDataOf(file: TrackFile): TrackData {
  const { source: _source, ...data } = file;
  return data;
}
