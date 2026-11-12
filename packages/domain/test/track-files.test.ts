// Track file validation (C62b, spec 3.1): the committed files in data/tracks/ and the validator's rejections.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackDataOf, validateTrackFile, type TrackFile } from '../src/index.ts';

const DIR = join(import.meta.dirname, '../../../data/tracks');
const NAMES = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const zandvoort = (): Record<string, any> => structuredClone(read('26.json')) as Record<string, any>;

const errorsOf = (json: unknown): string[] => {
  const r = validateTrackFile(json);
  if (r.ok) throw new Error('expected the file to be rejected');
  return r.errors;
};

describe('the committed track files', () => {
  it('has the files of the season', () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  it.each(NAMES)('%s validates, and is named by its track id', (name) => {
    const r = validateTrackFile(read(name));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(`${r.file.trackId}.json`).toBe(name);
  });

  it.each(NAMES)('%s: turns in lap order, zones disjoint in lap order, fractions in [0, 1), 500 outline points', (name) => {
    const r = validateTrackFile(read(name));
    if (!r.ok) throw new Error(r.errors.join('; '));
    const { outline, turns, brakingZones } = r.file;
    if (outline.known) expect(outline.value).toHaveLength(500);
    if (turns.known) {
      const apexes = turns.value.map((t) => t.apex);
      for (const a of apexes) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1);
      }
      expect(apexes).toEqual([...apexes].sort((a, b) => a - b));
    }
    if (brakingZones.known) {
      const zones = brakingZones.value;
      for (const z of zones) {
        expect(z.start).toBeGreaterThanOrEqual(0);
        expect(z.start).toBeLessThan(1);
        expect(z.end).toBeGreaterThanOrEqual(0);
        expect(z.end).toBeLessThan(1);
      }
      zones.forEach((z, i) => {
        if (z.start > z.end) expect(i, 'a wrapping zone is last').toBe(zones.length - 1);
        const next = zones[i + 1];
        if (next) expect(z.end, 'zones are disjoint, in lap order').toBeLessThan(next.start);
      });
      const wrap = zones.at(-1);
      if (wrap && wrap.start > wrap.end && zones.length > 1) expect(wrap.end).toBeLessThan(zones[0]!.start);
    }
    // drsZones is a Known part of every file; a known list holds lap fractions only.
    expect(r.file.drsZones).toHaveProperty('known');
    if (r.file.drsZones.known) {
      for (const z of r.file.drsZones.value) {
        for (const f of [z.detection, z.start, z.end]) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
        }
      }
    }
  });
});

describe('validateTrackFile rejections', () => {
  it('accepts the Zandvoort file', () => {
    expect(validateTrackFile(zandvoort()).ok).toBe(true);
  });

  it('rejects a non-integer Ms and names its path', () => {
    const json = zandvoort();
    json.defaults.pitLossMs.green.value.value = 23000.5;
    const errors = errorsOf(json);
    expect(errors.some((e) => e.includes('defaults.pitLossMs.green'))).toBe(true);
  });

  it.each([1, -0.1])('rejects a lap fraction of %s', (fraction) => {
    const turn = zandvoort();
    turn.turns.value[0].apex = fraction;
    expect(errorsOf(turn).some((e) => e.includes('turns'))).toBe(true);
    const zone = zandvoort();
    zone.brakingZones.value[0].start = fraction;
    expect(errorsOf(zone).some((e) => e.includes('brakingZones'))).toBe(true);
  });

  it('rejects a missing part', () => {
    const json = zandvoort();
    delete json.brakingZones;
    expect(errorsOf(json).some((e) => e.includes('brakingZones'))).toBe(true);
  });

  it('rejects a Known without known', () => {
    const json = zandvoort();
    delete json.realLengthM.known;
    expect(errorsOf(json).some((e) => e.includes('realLengthM'))).toBe(true);
  });

  it('rejects a missing drsZones part', () => {
    const json = zandvoort();
    delete json.drsZones;
    expect(errorsOf(json).some((e) => e.includes('drsZones'))).toBe(true);
  });

  it('rejects a drsZones value that is not a list', () => {
    const json = zandvoort();
    json.drsZones = { known: true, value: { detection: 0.1, start: 0.2, end: 0.3 }, at: 0 };
    expect(errorsOf(json).some((e) => e.includes('drsZones'))).toBe(true);
  });

  it.each(['detection', 'start', 'end'])('rejects a drs zone without %s and names its path', (field) => {
    const json = zandvoort();
    const full: Record<string, number> = { detection: 0.85, start: 0.9, end: 0.1 };
    const zone = Object.fromEntries(Object.entries(full).filter(([k]) => k !== field));
    json.drsZones = { known: true, value: [zone], at: 0 };
    expect(errorsOf(json).some((e) => e.includes('drsZones') && e.includes(field))).toBe(true);
  });

  it.each([
    ['detection', 1],
    ['start', -0.1],
    ['end', 1.2],
    ['start', Number.NaN],
  ])('rejects a drs zone %s of %s', (field, fraction) => {
    const json = zandvoort();
    const zone: Record<string, number> = { detection: 0.4, start: 0.45, end: 0.55 };
    zone[field] = fraction;
    json.drsZones = { known: true, value: [zone], at: 0 };
    expect(errorsOf(json).some((e) => e.includes('drsZones') && e.includes(field))).toBe(true);
  });

  it('accepts a valid drs zone list, a zone wrapping past the line included', () => {
    const json = zandvoort();
    json.drsZones = {
      known: true,
      value: [
        { detection: 0.3, start: 0.35, end: 0.45 },
        { detection: 0.88, start: 0.93, end: 0.04 },
      ],
      at: 0,
    };
    expect(validateTrackFile(json)).toMatchObject({ ok: true });
  });

  it('accepts an unknown drsZones part', () => {
    const json = zandvoort();
    json.drsZones = { known: false, reason: 'notReceived' };
    expect(validateTrackFile(json)).toMatchObject({ ok: true });
  });

  it('rejects a value that is not an object', () => {
    expect(validateTrackFile(null).ok).toBe(false);
  });
});

// SP4.3b Task 4 (spec §5.1, C3, C62b): the hazard is validated like every other part. A malformed hazard fails the
// whole file, as a bad pit-loss default does: the bridge's loader then gives `view.track` as `unknown('notApplicable')`
// and logs the validator's errors (apps/bridge/src/track-files/load.ts), so each error names `defaults.hazard`.
describe('the track hazard', () => {
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const inUnit = (p: number): boolean => Number.isFinite(p) && p >= 0 && p <= 1;

  it.each(NAMES)(
    "every committed track file's hazard validates: chances in [0, 1], byFraction ascending ending at 1, each duration pmf sums to 1 within 1e-9, races ≥ 1 (%s)",
    (name) => {
      const r = validateTrackFile(read(name));
      if (!r.ok) throw new Error(r.errors.join('; '));
      const hazard = r.file.defaults.hazard;
      expect(hazard).toHaveProperty('known');
      if (!hazard.known) return;
      expect(typeof hazard.value.source).toBe('string');
      const h = hazard.value.value;
      expect(Number.isInteger(h.races)).toBe(true);
      expect(h.races).toBeGreaterThanOrEqual(1);
      expect(inUnit(h.lapOne.sc) && inUnit(h.lapOne.vsc)).toBe(true);
      expect(h.byFraction.length).toBeGreaterThan(0);
      h.byFraction.forEach((b, i) => {
        expect(inUnit(b.sc) && inUnit(b.vsc), `byFraction[${i}] chances`).toBe(true);
        expect(b.upTo).toBeGreaterThan(i === 0 ? 0 : h.byFraction[i - 1]!.upTo);
      });
      expect(h.byFraction.at(-1)!.upTo).toBe(1);
      for (const pmf of [h.durationLaps.sc, h.durationLaps.vsc]) {
        expect(pmf.length).toBeGreaterThan(0);
        for (const p of pmf) expect(inUnit(p)).toBe(true);
        expect(Math.abs(sum(pmf) - 1)).toBeLessThanOrEqual(1e-9);
      }
    },
  );

  const withHazard = (edit: (h: Record<string, any>) => void): Record<string, any> => {
    const json = zandvoort();
    json.defaults.hazard = {
      known: true,
      value: {
        value: {
          races: 5,
          lapOne: { sc: 0.2, vsc: 0.03 },
          byFraction: [
            { upTo: 0.5, sc: 0.01, vsc: 0.005 },
            { upTo: 1, sc: 0.012, vsc: 0.006 },
          ],
          durationLaps: { sc: [0.1, 0.4, 0.5], vsc: [0.25, 0.75] },
        },
        source: 'test',
      },
      at: 0,
    };
    edit(json.defaults.hazard.value.value);
    return json;
  };

  it('accepts a valid hazard and an unknown one', () => {
    expect(validateTrackFile(withHazard(() => {}))).toMatchObject({ ok: true });
    const json = zandvoort();
    json.defaults.hazard = { known: false, reason: 'insufficientData' };
    expect(validateTrackFile(json)).toMatchObject({ ok: true });
  });

  it.each<[string, (h: Record<string, any>) => void]>([
    ['a lap-one chance above 1', (h) => (h.lapOne.sc = 1.2)],
    ['a negative lap-one chance', (h) => (h.lapOne.vsc = -0.01)],
    ['a byFraction chance above 1', (h) => (h.byFraction[0].vsc = 1.5)],
    ['a NaN byFraction chance', (h) => (h.byFraction[1].sc = Number.NaN)],
    ['byFraction not ascending', (h) => (h.byFraction = [{ upTo: 0.75, sc: 0.01, vsc: 0.01 }, { upTo: 0.5, sc: 0.01, vsc: 0.01 }, { upTo: 1, sc: 0.01, vsc: 0.01 }])],
    ['byFraction with a repeated upTo', (h) => (h.byFraction = [{ upTo: 0.5, sc: 0.01, vsc: 0.01 }, { upTo: 0.5, sc: 0.01, vsc: 0.01 }, { upTo: 1, sc: 0.01, vsc: 0.01 }])],
    ['the last upTo not 1', (h) => (h.byFraction[1].upTo = 0.9)],
    ['an empty byFraction', (h) => (h.byFraction = [])],
    ['an SC duration pmf not summing to 1', (h) => (h.durationLaps.sc = [0.1, 0.4, 0.4])],
    ['a VSC duration pmf not summing to 1', (h) => (h.durationLaps.vsc = [0.25, 0.75, 1e-6])],
    ['a negative duration chance', (h) => (h.durationLaps.sc = [-0.1, 0.6, 0.5])],
    ['races 0', (h) => (h.races = 0)],
  ])("a malformed hazard gives unknown('notApplicable') with the reason in the load log, never a throw: %s", (_case, edit) => {
    const json = withHazard(edit);
    expect(() => validateTrackFile(json)).not.toThrow();
    const r = validateTrackFile(json);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.startsWith('defaults.hazard')), r.errors.join('; ')).toBe(true);
  });

  it('rejects a missing hazard part', () => {
    const json = zandvoort();
    delete json.defaults.hazard;
    expect(errorsOf(json).some((e) => e.includes('defaults.hazard'))).toBe(true);
  });
});

describe('trackDataOf', () => {
  it('returns everything but source', () => {
    const file = zandvoort() as TrackFile;
    const data = trackDataOf(file);
    expect(data).not.toHaveProperty('source');
    const { source: _source, ...rest } = file;
    expect(data).toEqual(rest);
  });
});
