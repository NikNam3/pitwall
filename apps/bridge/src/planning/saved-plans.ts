// The team's saved plans (C62d, C70, C1a; SP4.3e spec §4.3 "Saved plans"): bridge user state, one file per plan,
// `PITWALL_DATA_DIR/plans/<team>/<id>.json`, tied to no session; each notes the basis and the race assumptions it was
// computed on, the forecast samples it planned on and its profile snapshot's fingerprint (`computedOn`, for display
// only; an SP4.3e file without the last two reads them as `[]` and `null`). Written atomically (C58); a file that cannot
// be read or is no saved plan is skipped with a warning (C3).
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decodeUiAction } from '@pitwall/contracts';
import { IMPORTED, PLAN_SLOTS, type EnteredSample, type ForecastSample, type Policy, type PreparedCar, type RaceAssumptions, type RaceConditions, type SavedPlan, type SessionBasis, type SessionRef, type Slot, type TeamId, type TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';

/** The race laps' range of the race assumptions (C73). */
export const MAX_RACE_LAPS = 100;

/** A plan id names a file: letters, digits, `-` and `_` only. */
const ID = /^[A-Za-z0-9_-]+$/;

export const isPlanId = (id: string): boolean => ID.test(id);

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isSlot = (raw: unknown): raw is Slot => typeof raw === 'string' && (PLAN_SLOTS as readonly string[]).includes(raw);
const isString = (raw: unknown): raw is string => typeof raw === 'string';

/** A stored policy, read with the uiActions' one policy decoder (C73): `undefined` when it is none. */
function policyOf(raw: unknown): Policy | undefined {
  const action = decodeUiAction({ kind: 'plans.prepare.save', feedId: 'file', carId: 0, slot: 'A', policy: raw });
  return action?.kind === 'plans.prepare.save' ? action.policy : undefined;
}

function preparedCarOf(raw: unknown): PreparedCar | undefined {
  if (!isObject(raw) || !Number.isInteger(raw.raceNumber) || !isObject(raw.slots)) return undefined;
  const slots: Partial<Record<Slot, Policy>> = {};
  for (const [slot, value] of Object.entries(raw.slots)) {
    const policy = policyOf(value);
    if (!isSlot(slot) || policy === undefined) return undefined;
    slots[slot] = policy;
  }
  const active = raw.active;
  if (active !== null && !(isSlot(active) && slots[active] !== undefined)) return undefined;
  return { raceNumber: raw.raceNumber as number, slots, active };
}

const refOf = (raw: unknown): SessionRef | undefined =>
  isObject(raw) && isString(raw.sessionUid) && isString(raw.weekendId) ? { sessionUid: raw.sessionUid as SessionRef['sessionUid'], weekendId: raw.weekendId } : undefined;

function basisOf(raw: unknown): SessionBasis | undefined {
  if (!isObject(raw) || !Array.isArray(raw.practice)) return undefined;
  const practice = raw.practice.map(refOf);
  const qualifying = raw.qualifying === null ? null : refOf(raw.qualifying);
  if (practice.some((r) => r === undefined) || qualifying === undefined) return undefined;
  return { practice: practice as SessionRef[], qualifying };
}

const WEATHERS: readonly string[] = ['clear', 'lightCloud', 'overcast', 'lightRain', 'heavyRain', 'storm'];
const TRENDS: readonly string[] = ['up', 'down', 'flat'];
const isFiniteNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);

/** A stored row's offset, weather and rain chance as an entered row holds them (the rest kept as stored). */
const isEnteredSample = (raw: unknown): raw is EnteredSample =>
  isObject(raw) && Number.isInteger(raw.offsetMs) && (raw.offsetMs as number) >= 0 && isString(raw.weather) && WEATHERS.includes(raw.weather)
  && isFiniteNumber(raw.rainPct) && raw.rainPct >= 0 && raw.rainPct <= 100;

const isForecastSample = (raw: unknown): raw is ForecastSample =>
  isEnteredSample(raw) && isFiniteNumber((raw as Record<string, unknown>).trackTempC) && isFiniteNumber((raw as Record<string, unknown>).airTempC)
  && TRENDS.includes((raw as Record<string, unknown>).trackTempTrend as string) && TRENDS.includes((raw as Record<string, unknown>).airTempTrend as string);

/** The conditions a plan was computed on; an SP4.3e file without any reads as `IMPORTED`. */
function conditionsOf(raw: unknown): RaceConditions | undefined {
  if (raw === undefined) return IMPORTED;
  if (!isObject(raw)) return undefined;
  if (raw.kind === 'imported') return IMPORTED;
  if (raw.kind !== 'entered' || !Array.isArray(raw.samples) || !raw.samples.every(isEnteredSample)) return undefined;
  return { kind: 'entered', samples: structuredClone(raw.samples as EnteredSample[]) };
}

function raceOf(raw: unknown): RaceAssumptions | undefined {
  if (!isObject(raw)) return undefined;
  const { laps, sets } = raw;
  if (!Number.isInteger(laps) || (laps as number) < 1 || (laps as number) > MAX_RACE_LAPS) return undefined;
  const conditions = conditionsOf(raw.conditions);
  return (sets === 'carried' || sets === 'fresh') && conditions !== undefined ? { laps: laps as number, sets, conditions } : undefined;
}

/** The samples a plan was computed with; an SP4.3e file without any reads as `[]`. */
function forecastOf(raw: unknown): ForecastSample[] | undefined {
  if (raw === undefined) return [];
  return Array.isArray(raw) && raw.every(isForecastSample) ? structuredClone(raw as ForecastSample[]) : undefined;
}

/** The fingerprint of the profile snapshot a plan was computed on; an SP4.3e file without one reads as `null`. */
const profilesOf = (raw: unknown): string | null | undefined => (raw === undefined || raw === null ? null : isString(raw) ? raw : undefined);

/** The file's `SavedPlan`, `undefined` when it is none (C3). */
function savedPlanOf(raw: unknown): SavedPlan | undefined {
  if (!isObject(raw) || !isString(raw.id) || !isPlanId(raw.id) || !isString(raw.name) || !isString(raw.savedAt)) return undefined;
  if (!Number.isInteger(raw.team) || !Number.isInteger(raw.trackId) || !Array.isArray(raw.cars) || !isObject(raw.computedOn)) return undefined;
  const basis = basisOf(raw.computedOn.basis);
  const race = raceOf(raw.computedOn.race);
  const forecast = forecastOf(raw.computedOn.forecast);
  const profiles = profilesOf(raw.computedOn.profiles);
  const cars = raw.cars.map(preparedCarOf);
  if (basis === undefined || race === undefined || forecast === undefined || profiles === undefined || cars.some((car) => car === undefined)) return undefined;
  return {
    id: raw.id,
    name: raw.name,
    team: raw.team as TeamId,
    trackId: raw.trackId as TrackId,
    savedAt: raw.savedAt,
    computedOn: { basis, race, forecast, profiles },
    cars: cars as PreparedCar[],
  };
}

/** The team's saved plans, as files under `<data dir>/plans/<team>/`. */
export class SavedPlanStore {
  readonly #root: string;
  readonly #log: Pick<Logger, 'warn'>;

  /** `dataDir`: `PITWALL_DATA_DIR`. */
  constructor(dataDir: string, log: Pick<Logger, 'warn'>) {
    this.#root = join(dataDir, 'plans');
    this.#log = log;
  }

  /** The team's saved plans on `trackId`, oldest saved first. */
  list(team: TeamId, trackId: TrackId): SavedPlan[] {
    return this.#ofTeam(team)
      .filter((plan) => plan.trackId === trackId)
      .sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0));
  }

  /** The saved plan `id` of any team; `undefined` when none is (or its file is no saved plan, warned). */
  read(id: string): SavedPlan | undefined {
    const path = this.#pathOf(id);
    return path === undefined ? undefined : this.#readFile(path);
  }

  /** Writes `plan` atomically, replacing a plan of the same id. */
  save(plan: SavedPlan): void {
    if (!isPlanId(plan.id)) throw new Error(`no plan id: ${plan.id}`);
    const old = this.#pathOf(plan.id);
    const dir = join(this.#root, String(plan.team));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${plan.id}.json`);
    writeAtomic(path, `${JSON.stringify(plan, null, 2)}\n`);
    if (old !== undefined && old !== path) rmSync(old, { force: true });
  }

  /** Renames the saved plan `id`; `false` when there is none. */
  rename(id: string, name: string): boolean {
    const plan = this.read(id);
    if (plan === undefined) return false;
    this.save({ ...plan, name });
    return true;
  }

  /** Deletes the saved plan `id`; `false` when there is none. */
  delete(id: string): boolean {
    const path = this.#pathOf(id);
    if (path === undefined) return false;
    rmSync(path, { force: true });
    return true;
  }

  /** The file of plan `id`, of whichever team holds it; `undefined` when none does. */
  #pathOf(id: string): string | undefined {
    if (!isPlanId(id) || !existsSync(this.#root)) return undefined;
    for (const team of readdirSync(this.#root)) {
      const path = join(this.#root, team, `${id}.json`);
      if (existsSync(path)) return path;
    }
    return undefined;
  }

  #ofTeam(team: TeamId): SavedPlan[] {
    const dir = join(this.#root, String(team));
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const plan = this.#readFile(join(dir, file));
        return plan === undefined ? [] : [plan];
      });
  }

  #readFile(path: string): SavedPlan | undefined {
    const text = readText(path);
    if (text === undefined) return undefined;
    const parsed = parseJson(text);
    const plan = parsed.ok ? savedPlanOf(parsed.value) : undefined;
    if (plan === undefined) this.#log.warn({ path, ...(parsed.ok ? {} : { err: parsed.message }) }, 'saved plan not read: the file is no saved plan, skipped');
    return plan;
  }
}
