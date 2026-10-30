// The only place numbers become text (spec 5): every value cell formats through one of these.
import { trackName, type Celsius, type CarId, type Kg, type Ms, type Percent, type Psi, type SessionKind } from '@pitwall/domain';

/** The one minus glyph of every signed value (U+2212): as wide as `+` in the mono font. */
export const MINUS = '−';

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
  const sign = ms < 0 ? MINUS : '+';
  return abs < 60000 ? `${sign}${formatSector(abs)}` : `${sign}${minutesSeconds(abs, 1)}`;
}

/** Sector time, `23456` -> `23.456`. */
export function formatSector(ms: Ms): string {
  const total = Math.round(ms);
  return `${Math.floor(total / 1000)}.${pad(total % 1000, 3)}`;
}

/**
 * `toFixed` with the true minus (`MINUS`) and a negative zero shown as 0, `-1.25` at one decimal -> `−1.3`,
 * `-0.04` -> `0.0`; every signed number becomes text here, and the grid helper re-exports it. A value that is not a
 * finite number (a field missing at run time) is empty.
 */
export function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '';
  const text = value.toFixed(decimals);
  if (/^-0(\.0*)?$/.test(text)) return text.slice(1);
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text;
}

/** A whole number with the true minus, `-3.4` -> `−3`, `-0.2` -> `0`. */
const whole = (n: number): string => fixed(n, 0);

/** Temperature to whole degrees in a tight grid cell, `94.6` -> `95°`; in text a temperature is `formatCelsius`. */
export const formatTemp = (c: Celsius): string => (Number.isFinite(c) ? `${whole(c)}°` : '');

/** One decimal, a negative zero shown as 0. */
const fixed1 = (n: number): string => fixed(n, 1);

/** Tyre pressure to one decimal, `23.456` -> `23.5`. */
export const formatPsi = (p: Psi): string => (Number.isFinite(p) ? fixed1(p) : '');

/** Mass in kg to one decimal, `10` -> `10.0`. */
export const formatKg = (k: Kg): string => (Number.isFinite(k) ? fixed1(k) : '');

/** Percentage to whole numbers, `12.34` -> `12%`. */
export const formatPct = (p: Percent): string => `${whole(p)}%`;

/** Whole number, `42.4` -> `42`. */
export const formatCount = (n: number): string => whole(n);

/** Packets per second, `59.6` -> `60/s`. */
export const formatRate = (perSecond: number): string => `${whole(perSecond)}/s`;

/**
 * Loss to one decimal so a threshold near a whole number stays readable, `4.94` -> `4.9%`; from 10 % whole, so the
 * text never grows past `100%`: `10.2` -> `10%`.
 */
export const formatLoss = (p: Percent): string => `${fixed(p, Math.abs(p) < 9.95 ? 1 : 0)}%`;

/** Whole milliseconds, `12.4` -> `12 ms`. */
export const formatMillis = (ms: Ms): string => `${whole(ms)} ms`;

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

/** A lap number, `23` -> `L23`, zero-padded to `width` digits when given, `9` at width 2 -> `L09` (a count says `laps`, see `formatLaps`). */
export const formatLapNumber = (n: number, width = 1): string => (Number.isFinite(n) ? `L${String(Math.round(n)).padStart(width, '0')}` : '');

/** A count of laps to one decimal, `1.8` -> `1.8 laps`. */
export const formatLaps = (n: number): string => (Number.isFinite(n) ? `${fixed(n, 1)} laps` : '');

/** The one temperature with its unit, to whole degrees (alarm texts, the engine line), `94.6` -> `95 °C`. */
export const formatCelsius = (c: Celsius): string => (Number.isFinite(c) ? `${whole(c)} °C` : '');

/** Percentage to whole numbers, `17.6` -> `18%`. */
export const formatPercent = (p: Percent): string => (Number.isFinite(p) ? formatPct(p) : '');

/** Joules as MJ to one decimal, no unit, `2100000` -> `2.1`, `-400000` -> `−0.4`. */
export const formatMJ = (j: number): string => (Number.isFinite(j) ? fixed(j / 1e6, 1) : '');

/** Joules as signed MJ to one decimal, no unit, `1200000` -> `+1.2`, `-400000` -> `−0.4`; zero is unsigned. */
export const formatSignedMJ = (j: number): string => {
  const text = formatMJ(j);
  return text === '' || text.startsWith(MINUS) || Number(text) === 0 ? text : `+${text}`;
};

/** Energy shown as MJ with one decimal, `2100000` -> `2.1 MJ`. */
export const formatJoules = (j: number): string => (Number.isFinite(j) ? `${formatMJ(j)} MJ` : '');

/** Seconds from ms, no unit, `4100` -> `4.1`, `-4100` -> `−4.1`; the caller names the unit. */
export const formatSeconds = (ms: Ms, decimals: number): string => (Number.isFinite(ms) ? fixed(ms / 1000, decimals) : '');

/** Signed seconds from ms, `120` at 2 decimals -> `+0.12`, `-120` -> `−0.12`; a value that rounds to zero reads `+`. */
export const formatSignedSeconds = (ms: Ms, decimals: number): string => {
  if (!Number.isFinite(ms)) return '';
  const text = fixed(Math.abs(ms) / 1000, decimals);
  return `${ms < 0 && Number(text) !== 0 ? MINUS : '+'}${text}`;
};

/** Laps a car is down, signed: `2` -> `+2 laps`, laps ahead `-1` -> `−1 lap`. */
export const formatLapsDown = (n: number): string =>
  Number.isFinite(n) ? `${n < 0 ? MINUS : '+'}${Math.abs(n)} ${Math.abs(n) === 1 ? 'lap' : 'laps'}` : '';

/** A time penalty from ms to whole seconds, `5000` -> `5s`. */
export const formatPenaltyMs = (ms: Ms): string => (Number.isFinite(ms) ? `${whole(ms / 1000)}s` : '');

/** A warning count, `2` -> `2w`. */
export const formatWarnings = (n: number): string => (Number.isFinite(n) ? `${n}w` : '');

/** A race position, `7` -> `7`; unknown is empty. */
export const formatPlace = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '' : formatCount(n));

/** A time loss in ms per lap as signed seconds to two decimals, `120` -> `+0.12 s/lap`. */
export const formatSecondsPerLap = (ms: Ms): string => (Number.isFinite(ms) ? `${formatSignedSeconds(ms, 2)} s/lap` : '');

/** A rate in ms per lap as seconds to two decimals without a forced plus, `310` -> `0.31 s/lap`, `-120` -> `−0.12 s/lap`. */
export const formatSecondsPerLapPlain = (ms: Ms): string => (Number.isFinite(ms) ? `${formatSeconds(ms, 2)} s/lap` : '');

/** A race position with its P, `7` -> `P7`. */
export const formatPosition = (n: number): string => (Number.isFinite(n) ? `P${formatCount(n)}` : '');

/** A delta in ms as signed seconds, `412` -> `+0.412`, `-412` -> `−0.412`. */
export const formatDeltaMs = (ms: Ms): string => {
  if (!Number.isFinite(ms)) return '';
  const abs = Math.abs(Math.round(ms));
  return `${ms < 0 && abs > 0 ? MINUS : '+'}${formatSector(abs)}`;
};

/** A signed count of laps to one decimal with a true minus, `1.8` -> `+1.8 laps`, `-0.7` -> `−0.7 laps`. */
export const formatSignedLaps = (n: number): string => {
  if (!Number.isFinite(n)) return '';
  const text = fixed(Math.abs(n), 1);
  return `${n < 0 && text !== '0.0' ? MINUS : '+'}${text} laps`;
};

/** Fuel burn or save target to two decimals, `1.62` -> `1.62 kg/lap`. */
export const formatKgPerLap = (kg: Kg): string => (Number.isFinite(kg) ? `${fixed(kg, 2)} kg/lap` : '');

/** A count of whole laps, rounded down: the laps one can still complete, `12.9` -> `12`. */
export const formatWholeLaps = (n: number): string => (Number.isFinite(n) ? whole(Math.floor(n)) : '');

/** Mass with its unit, `10` -> `10.0 kg`. */
export const formatKgUnit = (k: Kg): string => (Number.isFinite(k) ? `${fixed1(k)} kg` : '');

/** A whole number without a unit (grid cells), `94.6` -> `95`, `-0.2` -> `0`. */
export const formatWhole = (n: number): string => (Number.isFinite(n) ? whole(n) : '');

/** A relative change in percent with its sign and unit, `12.4` -> `+12 %`, `-3` -> `−3 %`. */
export const formatDeltaPct = (pct: Percent): string => {
  if (!Number.isFinite(pct)) return '';
  const text = whole(Math.abs(pct));
  return `${pct < 0 && text !== '0' ? MINUS : '+'}${text} %`;
};

// gap chart

/** A y tick of the gap chart from the plotted (negated) value, as seconds behind the reference: `-5` -> `+5`, `5` -> `−5`, `0` -> `0`. */
export const formatGapTick = (plotted: number): string => {
  if (!Number.isFinite(plotted)) return '';
  const behind = Math.round(-plotted * 100) / 100;
  if (behind === 0) return '0';
  return behind > 0 ? `+${behind}` : `${MINUS}${-behind}`;
};
