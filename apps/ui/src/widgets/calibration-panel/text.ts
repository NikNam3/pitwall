// Wording of the calibration panel (mockup docs/design/2026-11-06-sp4.1a/calibration-panel.html); text shared with the
// kit and the shell (the prompt's) lives in kit/text.ts.
import type { LapUse, SkippedSource } from '@pitwall/domain';
import { calibration, separator } from '../../kit/text.ts';
import { formatCount } from '../../kit/values/format.ts';

/** The set picker's label (full mode). */
export const setLabel = 'set';
/** The track picker's label, without a running session. */
export const trackLabel = 'track';
/** The name field's label while a set is made, copied or renamed. */
export const nameLabel = 'name';
export const nameHint = ['Enter saves', 'Esc cancels'].join(separator);

/** The set actions, quiet words. */
export const actions = { new: 'new', copy: 'copy', rename: 'rename', delete: 'delete' } as const;
export const add = 'add';
export const remove = '×';
export const removeHover = 'remove this source from the set';

/** Whether the picked set is the one the running race uses. */
export const activeInRace = 'active in this race';
export const notInRace = 'not used in this race';
export const noSession = 'no session';
/** The same in compact mode. */
export const activeShort = 'active';
export const notInRaceShort = 'not used';
export const activeHover = 'calibration.active: the set this race runs on';

export const noTrack = 'no stored session yet';
export const noSet = 'no set on this track: new makes one';
export const noSetShort = 'no set';
export const noTrackShort = 'no session stored';

/** Between the running session's track and the set's dates. */
export const afterTrack = separator;
/** The set's dates and sources under the picker: `created 28 Sep · last used 15 Oct · 4 sources`. */
export const setDates = (created: string, lastUsed: string | undefined, sources: number): string =>
  [`created ${created}`, ...(lastUsed === undefined ? [] : [`last used ${lastUsed}`]), calibration.sources(sources)].join(separator);

/** Section titles and their notes. */
export const sourcesTitle = 'SOURCES';
export const sourcesNote = `${separator}one stint each; ▸ opens its laps`;
export const suggestionsTitle = 'SUGGESTIONS';
export const suggestionsNote = `${separator}our stints on this track not in the set, this weekend first`;
export const noSuggestions = 'none';
export const valuesTitle = 'VALUES PER COMPOUND';
export const valuesNote = `${separator}deg s/lap, wear %/lap; ovr = your override`;
export const limitsTitle = 'LIMITS';
export const pitTitle = 'PIT LOSS PER CONDITION';
export const pitNote = `${separator}s`;
export const overrideRow = 'ovr';

/** The opener of a source's laps. */
export const opener = { open: '▾', closed: '▸' } as const;

/** Headers of the sources (and suggestions) table by column key. */
export const sourceHeaders = {
  open: '', session: 'SESSION', date: 'DATE', car: 'CAR', cmp: 'CMP', stint: 'STINT', laps: 'LAPS', deg: 'DEG/LAP', drift: 'DRIFT', act: '',
} as const;
/** LAPS: used of the stint's laps, `17/22`. */
export const usedOf = (used: number, laps: number): string => `${formatCount(used)}/${formatCount(laps)}`;
export const usedOfHover = (used: number, laps: number): string => `${formatCount(used)} used of ${formatCount(laps)} laps`;
export const driftHover = "this source minus the set, in sd of the set's value";

/** A skipped source: the word in its row and why on hover. */
export const missing = 'missing';
export const stale = 'stale';
export const skippedWord = { missing, stale } as const satisfies Record<SkippedSource['skipped'], string>;
export const skippedHover = {
  missing: calibration.missingHover,
  stale: 'its session awaits a rebuild with the current rules: left out of every value until then',
} as const satisfies Record<SkippedSource['skipped'], string>;

/** A lap of an opened source: the toggle of a lap the fit may use, and why a lap is never used. */
export const lapToggle = { kept: '[x]', excluded: '[ ]' } as const;
export const lapExcludedHover = 'excluded by you';
export const lapDownWeightedHover = 'down-weighted: slower than the fit expects';
type NeverPace = Exclude<LapUse, 'used' | 'downWeighted'>['excluded'];
export const neverPace = { notForPace: 'other', inLap: 'in', outLap: 'out', neutralised: 'SC/VSC' } as const satisfies Record<NeverPace, string>;
export const neverPaceHover = 'not a pace lap: never used';

/** Headers of the values table by column key. */
export const valueHeaders = { cmp: 'CMP', offset: 'TO SOFT', deg: 'DEG/LAP', sd: 'SD', fl: 'FL', fr: 'FR', rl: 'RL', rr: 'RR' } as const;
/** An entry no source of the set covers. */
export const noSource = 'no source in this set covers it';
export const overrideHover = (value: string): string => `your override ${value}`;
/** The two limits of tyre-life. */
export const limits = { wearLimit: 'wear limit', ageLossLimit: 'age loss limit' } as const;
/** The pit-loss conditions and the table's headers. */
export const conditions = { green: 'green', vsc: 'VSC', sc: 'SC' } as const;
export const pitHeaders = { cond: 'COND', set: 'SET', ovr: 'OVR' } as const;
/** The compact mode's line labels. */
export const compactDeg = 'deg';
export const compactPit = 'pit';

/** The bridge's reason for a rejected action, below the set line. */
export const rejected = (message: string): string => `rejected: ${message}`;
export const rejectedNoReason = 'the bridge did not accept it';
