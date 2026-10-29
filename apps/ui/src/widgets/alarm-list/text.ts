// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
import type { InsightCategory } from '@pitwall/domain';
import { alertGroups } from '../../kit/text.ts';

export const severityLabel = { critical: 'CRIT', advisory: 'ADV', info: 'INFO' } as const;
export const acknowledged = 'acknowledged';
export const ack = 'ack';
/** The mute button of a row, `mute tyres`. */
export const muteGroup = (category: InsightCategory): string => `${alertGroups.mute} ${alertGroups.category[category]}`;
/** The hover text of a muted group's button. */
export const unmute = alertGroups.unmute;
export const none = 'no alarms';
/** The muted-groups line: `muted: energy (1)`. */
export const mutedGroup = (category: InsightCategory, count: number): string => `${alertGroups.category[category]} (${count})`;
export const mutedLabel = 'muted:';
/** The last line's count of the alarms that do not fit: `+3`. */
export const more = (n: number): string => `+${n}`;
