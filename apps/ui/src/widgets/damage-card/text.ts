// Words of the damage-card display, in one place.
export const labels = { wing: 'WING', floor: 'FLOOR', diffuser: 'DIFF', sidepod: 'SIDEPOD', gearbox: 'GBX', engine: 'ENG' } as const;
/** Header over the wing columns. */
export const wingHeader = ['L', 'R', 'REAR'] as const;
/** Labels of the per-corner values. */
export const cornerLabels = { tyre: 'TYRE', brake: 'BRAKE' } as const;
/** The loss of a jump whose lap-time cost is still being measured. */
export const lossMeasuring = 'loss: measuring';
/** Loss text of a measured jump, `loss +0.12 s/lap`. */
export const lossMeasured = (seconds: string): string => `loss ${seconds}`;

/** The faults the card lists. */
export const faults = { drs: 'DRS fault', ers: 'ERS fault' } as const;
/** Joins the parts of a jump (`wing + floor`). */
export const partSeparator = ' + ';
/** Joins the faults in the compact view. */
export const faultSeparator = ' · ';

/** The compact damage line, `W12/0/3 F4 D0 S1 G0 E2`: one letter per part, the wings as left/right/rear. */
export const compactParts = (v: {
  wings: readonly [string, string, string];
  floor: string; diffuser: string; sidepod: string; gearbox: string; engine: string;
}): string => `W${v.wings.join('/')} F${v.floor} D${v.diffuser} S${v.sidepod} G${v.gearbox} E${v.engine}`;
