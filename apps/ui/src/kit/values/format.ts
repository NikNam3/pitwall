// The only place numbers become text (spec 5): every value cell formats through one of these.
import { trackName, type Celsius, type CarId, type Kg, type Ms, type Percent, type Psi, type SessionKind } from '@pitwall/domain';

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** `m:ss.mmm` for a non-negative duration. */
function minutesSeconds(ms: Ms, minuteWidth: number): string {
  const total = Math.round(ms);
  const minutes = Math.floor(total / 60000);
  return `${pad(minutes, minuteWidth)}:${pad(Math.floor((total % 60000) / 1000), 2)}.${pad(total % 1000, 3)}`;
}

/** Session clock to whole seconds, `4324000` -> `1:12:04`, `471000` -> `0:07:51`. */
export function formatSessionClock(ms: Ms): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60), 2)}:${pad(seconds % 60, 2)}`;
}

/** Lap time, `83456` -> `1:23.456`. */
export const formatLapTime = (ms: Ms): string => minutesSeconds(ms, 1);

/** Signed gap, `1234` -> `+1.234`, `65000` -> `+1:05.000`. */
export function formatGap(ms: Ms): string {
  const abs = Math.abs(Math.round(ms));
  const sign = ms < 0 ? '-' : '+';
  return abs < 60000 ? `${sign}${formatSector(abs)}` : `${sign}${minutesSeconds(abs, 1)}`;
}

/** Sector time, `23456` -> `23.456`. */
export function formatSector(ms: Ms): string {
  const total = Math.round(ms);
  return `${Math.floor(total / 1000)}.${pad(total % 1000, 3)}`;
}

/** Temperature to whole degrees, `94.6` -> `95°`. */
export const formatTemp = (c: Celsius): string => `${Math.round(c) + 0}°`;

/** `toFixed` with a negative zero shown as 0, `-0.04` at one decimal -> `0.0`; the grid helper re-exports it. */
export function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/** One decimal, a negative zero shown as 0. */
const fixed1 = (n: number): string => fixed(n, 1);

/** Tyre pressure to one decimal, `23.456` -> `23.5`. */
export const formatPsi = (p: Psi): string => (Number.isFinite(p) ? fixed1(p) : '');

/** Mass in kg to one decimal, `10` -> `10.0`. */
export const formatKg = (k: Kg): string => (Number.isFinite(k) ? fixed1(k) : '');

/** Percentage to whole numbers, `12.34` -> `12%`. */
export const formatPct = (p: Percent): string => `${Math.round(p) + 0}%`;

/** Whole number, `42.4` -> `42`. */
export const formatCount = (n: number): string => `${Math.round(n) + 0}`;

/** Packets per second, `59.6` -> `60/s`. */
export const formatRate = (perSecond: number): string => `${Math.round(perSecond) + 0}/s`;

/** Loss to one decimal so a threshold near a whole number stays readable, `4.99` -> `5.0%`. */
export const formatLoss = (p: Percent): string => `${p.toFixed(1)}%`;

/** Whole milliseconds, `12.4` -> `12 ms`. */
export const formatMillis = (ms: Ms): string => `${Math.round(ms) + 0} ms`;

/** Car index as a car number, `7` -> `#7`. */
export const formatCarNumber = (id: CarId): string => `#${id}`;

const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  unknown: 'unknown',
  practice: 'practice',
  qualifying: 'qualifying',
  sprintShootout: 'sprint shootout',
  race: 'race',
  timeTrial: 'time trial',
};

/** Session kind in words, `sprintShootout` -> `sprint shootout`. */
export const formatSessionKind = (kind: SessionKind): string => SESSION_KIND_LABEL[kind];

/** Track by its game id, `26` -> `Zandvoort`; an id the game does not list by number, `1` -> `track 1`. */
export const formatTrack = (trackId: number): string => trackName(trackId) ?? `track ${trackId}`;

/** A rate, `10` -> `10 Hz`. */
export const formatHz = (hz: number): string => `${hz} Hz`;

/** A compute time to two decimals, `0.456` -> `0.46 ms`. */
export const formatMs = (ms: number): string => `${Math.round(ms * 100) / 100} ms`;

/** The wall-clock time of day, `14:03:09`. */
export const formatClock = (at: Date): string => at.toTimeString().slice(0, 8);

/** A value as short JSON, cut to `max` characters with `…`. */
export function formatShort(value: unknown, max: number): string {
  const json = JSON.stringify(value) ?? String(value);
  return json.length <= max ? json : `${json.slice(0, max - 1)}…`;
}

/** Replay speed factor, `0.5` -> `×0.5`. */
export const formatFactor = (factor: number): string => `×${factor}`;

/** A lap number, `23` -> `L23` (a count says `laps`, see `formatLaps`). */
export const formatLapNumber = (n: number): string => (Number.isFinite(n) ? `L${Math.round(n)}` : '');

/** A count of laps to one decimal, `1.8` -> `1.8 laps`. */
export const formatLaps = (n: number): string => (Number.isFinite(n) ? `${fixed(n, 1)} laps` : '');

/** Temperature to whole degrees, `94.6` -> `95°`. */
export const formatCelsius = (c: Celsius): string => (Number.isFinite(c) ? formatTemp(c) : '');

/** Percentage to whole numbers, `17.6` -> `18%`. */
export const formatPercent = (p: Percent): string => (Number.isFinite(p) ? formatPct(p) : '');

/** Energy shown as MJ with one decimal, `2100000` -> `2.1 MJ`. */
export const formatJoules = (j: number): string => (Number.isFinite(j) ? `${fixed(j / 1e6, 1)} MJ` : '');

/** A time loss in ms per lap as signed seconds to two decimals, `120` -> `+0.12 s/lap`. */
export const formatSecondsPerLap = (ms: Ms): string => {
  if (!Number.isFinite(ms)) return '';
  const text = fixed(ms / 1000, 2);
  return `${text.startsWith('-') ? '' : '+'}${text} s/lap`;
};

/** A delta in ms as signed seconds, `412` -> `+0.412`, `-412` -> `-0.412`. */
export const formatDeltaMs = (ms: Ms): string => {
  if (!Number.isFinite(ms)) return '';
  const abs = Math.abs(Math.round(ms));
  return `${ms < 0 && abs > 0 ? '-' : '+'}${formatSector(abs)}`;
};
