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

  it('rejects a value that is not an object', () => {
    expect(validateTrackFile(null).ok).toBe(false);
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
