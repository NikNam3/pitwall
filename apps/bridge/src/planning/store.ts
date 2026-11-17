// The prepared plans (SP4.3d spec §7.0 rule 6, §7.4; C62d, C70): bridge user state, one file per race and team,
// `PITWALL_DATA_DIR/plans/<weekendId>/<format>/<team>.json`, changed only through the planning module's uiActions
// (C73). Written atomically (C58); a file that cannot be read or is no `PreparedPlans` reads as empty, with a warning (C3).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeUiAction } from '@pitwall/contracts';
import { PLAN_SLOTS, type Policy, type PreparedCar, type PreparedPlans, type RaceFormat, type Slot, type TeamId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';

/** The race a prepared-plans file is for (§7.0 rule 6): the weekend, the race's format, our team. */
export type RaceKey = { weekendId: string; format: RaceFormat; team: TeamId };

/** The entered race laps' range (C73). */
export const MAX_RACE_LAPS = 100;

export const emptyPlans = (): PreparedPlans => ({ laps: null, cars: [] });

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isSlot = (raw: unknown): raw is Slot => typeof raw === 'string' && (PLAN_SLOTS as readonly string[]).includes(raw);

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

/** The file's `PreparedPlans`, `undefined` when it is none (C3). */
function preparedPlansOf(raw: unknown): PreparedPlans | undefined {
  if (!isObject(raw) || !Array.isArray(raw.cars)) return undefined;
  const { laps } = raw;
  if (laps !== null && !(Number.isInteger(laps) && (laps as number) >= 1 && (laps as number) <= MAX_RACE_LAPS)) return undefined;
  const cars = raw.cars.map(preparedCarOf);
  if (cars.some((car) => car === undefined)) return undefined;
  return { laps: laps as number | null, cars: cars as PreparedCar[] };
}

/** The team's prepared plans per race, as files under `<data dir>/plans/`. */
export class PreparedStore {
  readonly #root: string;
  readonly #log: Pick<Logger, 'warn'>;

  /** `dataDir`: `PITWALL_DATA_DIR`. */
  constructor(dataDir: string, log: Pick<Logger, 'warn'>) {
    this.#root = join(dataDir, 'plans');
    this.#log = log;
  }

  /** The file of `key`'s race. */
  pathOf(key: RaceKey): string {
    return join(this.#root, key.weekendId, key.format, `${key.team}.json`);
  }

  /** The prepared plans for `key`'s race; empty without a file, and with a warning for one that is not readable or valid. */
  read(key: RaceKey): PreparedPlans {
    const path = this.pathOf(key);
    const text = readText(path);
    if (text === undefined) return emptyPlans();
    const parsed = parseJson(text);
    const plans = parsed.ok ? preparedPlansOf(parsed.value) : undefined;
    if (plans === undefined) {
      this.#log.warn({ path, ...(parsed.ok ? {} : { err: parsed.message }) }, 'prepared plans not read: the file is no prepared plans, read as empty');
      return emptyPlans();
    }
    return plans;
  }

  /** Writes `plans` for `key`'s race atomically. */
  write(key: RaceKey, plans: PreparedPlans): void {
    const path = this.pathOf(key);
    mkdirSync(dirname(path), { recursive: true });
    writeAtomic(path, `${JSON.stringify(plans, null, 2)}\n`);
  }
}
