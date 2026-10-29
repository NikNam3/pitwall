// Sector status and our-car emphasis (spec 8.4, A.4; presentation rule B2: purple for every car, green for our cars only).
import type { SectorStatus } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { ourCarRole, sectorStatusRole } from '../../src/emphasis/index.ts';

describe('sectorStatusRole', () => {
  it('a session best is the purple role for our car and for a rival', () => {
    expect(sectorStatusRole('sessionBest', { ours: true })).toBe('best');
    expect(sectorStatusRole('sessionBest', { ours: false })).toBe('best');
  });
  it('a personal best is green for our car only', () => {
    expect(sectorStatusRole('personalBest', { ours: true })).toBe('personalBest');
    expect(sectorStatusRole('personalBest', { ours: false })).toBeUndefined();
  });
  it('no status is neutral for every car', () => {
    expect(sectorStatusRole('none', { ours: true })).toBeUndefined();
    expect(sectorStatusRole('none', { ours: false })).toBeUndefined();
  });
  it('every status is covered', () => {
    const statuses: SectorStatus[] = ['sessionBest', 'personalBest', 'none'];
    for (const s of statuses) expect(() => sectorStatusRole(s, { ours: false })).not.toThrow();
  });
});

describe('ourCarRole', () => {
  it('our cars take the own-car role, others stay neutral', () => {
    expect(ourCarRole(true)).toBe('ownCar');
    expect(ourCarRole(false)).toBeUndefined();
  });
});
