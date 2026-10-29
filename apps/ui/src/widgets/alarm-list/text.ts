// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const severityLabel = { critical: 'CRIT', advisory: 'ADV', info: 'INFO' } as const;
export const acknowledged = 'acknowledged';
export const ack = 'ack';
export const mute = 'mute';
export const unmute = 'unmute';
export const none = 'no alarms';
/** The muted-groups line: `muted: energy (1)`. */
export const mutedGroup = (category: string, count: number): string => `${category} (${count})`;
export const mutedLabel = 'muted:';
/** The last line's count of the alarms that do not fit: `+3`. */
export const more = (n: number): string => `+${n}`;
