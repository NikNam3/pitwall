// Gallery declaration of the damage-card display (spec 9.1). Test-phase file: the implementer does not edit it.
import { known, unknown } from '@pitwall/domain';
import type { DamageJump, DamageParts, DamageState } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = 10;
const clean: DamageParts = {
  frontLeftWingPct: 0, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0,
};
const worn: DamageParts = { ...clean, frontLeftWingPct: 12, floorPct: 4, sidepodPct: 2, gearboxPct: 8, enginePct: 11 };
const corners = (tyre: number) => {
  const c = (t: number) => ({ tyrePct: known(t, at), brakePct: known(0, at) });
  return { fl: c(tyre), fr: c(1), rl: c(0), rr: c(0) };
};

const measuring: DamageJump = { at: 200_000, lap: 14, parts: ['frontLeftWingPct'], deltaPct: 12, lossMsPerLap: unknown('insufficientData') };
const measured: DamageJump = { at: 100_000, lap: 9, parts: ['floorPct'], deltaPct: 4, lossMsPerLap: known(120, 150_000) };

const base = (over: Partial<DamageState>): DamageState => ({
  parts: known(worn, at), corners: corners(3), drsFault: known(false, at), ersFault: false, jumps: [], ...over,
});

/** Synthetic cases and fit expectations for `damage-card`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'raceSingaporeEnd.chequered'],
  cases: {
    // Mockup: a new wing jump (red, loss still measuring) over an older floor jump with its measured loss.
    twoJumps: { damage: base({ jumps: [measured, measuring] }) },
    undamaged: { damage: base({ parts: known(clean, at), corners: corners(0) }) },
    measuredLoss: { damage: base({ jumps: [{ ...measuring, lossMsPerLap: known(310, 300_000) }, measured] }) },
    faults: { damage: base({ drsFault: known(true, at), ersFault: true }) },
    // A rival linked as primary in realism mode: every value is hidden.
    realismHidden: {
      damage: base({
        parts: unknown('realism'), drsFault: unknown('realism'),
        corners: { fl: hiddenCorner(), fr: hiddenCorner(), rl: hiddenCorner(), rr: hiddenCorner() },
      }),
    },
  },
  fit: [
    { mode: 'compact', cols: 26, rows: 2 },
    { mode: 'compact', cols: 35, rows: 3 },
    { mode: 'full', cols: 44, rows: 9 },
    { mode: 'full', cols: 60, rows: 12 },
  ],
};

function hiddenCorner() {
  return { tyrePct: unknown('realism' as const), brakePct: unknown('realism' as const) };
}

export default gallery;
