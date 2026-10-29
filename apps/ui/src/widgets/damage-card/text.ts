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
