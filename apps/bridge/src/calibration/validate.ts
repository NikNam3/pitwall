// Checks a calibration uiAction against the sets, the stored sessions and the declared priors keys (C62a, C73, spec
// 3.1) and gives the edit it makes, or the reason it is rejected; a rejected action changes nothing.
import type { UiAction } from '@pitwall/contracts';
import type { CalibrationSet, CalibrationSource } from '@pitwall/domain';
import type { PriorDecl } from '@pitwall/engine/readers';
import type { TrackSession } from '../storage/weekend-repository.ts';
import { newSetId, sameStint } from './sets.ts';
import { ourCars } from './suggest.ts';

/** The uiActions the calibration store applies: every `calibration.*` kind but `calibration.choose` (a decision, C76). */
export type CalibrationAction = Exclude<Extract<UiAction, { kind: `calibration.${string}` }>, { kind: 'calibration.choose' }>;

const KINDS: ReadonlySet<string> = new Set<CalibrationAction['kind']>([
  'calibration.set.create', 'calibration.set.copy', 'calibration.set.rename', 'calibration.set.delete',
  'calibration.source.add', 'calibration.source.remove', 'calibration.lap.exclude', 'calibration.lap.include',
  'calibration.override.set', 'calibration.override.clear',
]);

export const isCalibrationAction = (action: UiAction): action is CalibrationAction => KINDS.has(action.kind);

/** What an accepted action does to the set files. */
export type Edit = { write: CalibrationSet } | { remove: CalibrationSet };
export type Checked = { ok: true; edit: Edit } | { ok: false; message: string };

export type CheckCtx = {
  /** Every set, of every track. */
  sets: readonly CalibrationSet[];
  /** The stored sessions on a track. */
  sessionsOnTrack: (trackId: number) => readonly TrackSession[];
  /** A declared priors key's declaration. */
  entry: (key: string) => PriorDecl | undefined;
  /** Now, as an ISO date (a set's `createdAt`). */
  now: () => string;
};

const reject = (message: string): Checked => ({ ok: false, message });
const write = (set: CalibrationSet): Checked => ({ ok: true, edit: { write: set } });

export function checkAction(action: CalibrationAction, ctx: CheckCtx): Checked {
  if (action.kind === 'calibration.set.create') {
    const name = action.name.trim();
    const problem = nameProblem(name, action.trackId, ctx.sets);
    if (problem !== undefined) return reject(problem);
    const id = newSetId(name, new Set(ctx.sets.map((s) => s.id)));
    return write({ id, trackId: action.trackId, name, createdAt: ctx.now(), sources: [], overrides: {} });
  }
  const set = ctx.sets.find((s) => s.id === action.setId && s.trackId === action.trackId);
  if (set === undefined) return reject(`no set "${action.setId}" on track ${action.trackId}`);
  switch (action.kind) {
    case 'calibration.set.copy': {
      const name = action.name.trim();
      const problem = nameProblem(name, set.trackId, ctx.sets);
      if (problem !== undefined) return reject(problem);
      const id = newSetId(name, new Set(ctx.sets.map((s) => s.id)));
      return write({
        id, trackId: set.trackId, name, createdAt: ctx.now(),
        sources: set.sources.map((s) => ({ ...s, excludedLaps: [...s.excludedLaps] })), overrides: { ...set.overrides },
      });
    }
    case 'calibration.set.rename': {
      const name = action.name.trim();
      const problem = name === set.name ? undefined : nameProblem(name, set.trackId, ctx.sets);
      return problem !== undefined ? reject(problem) : write({ ...set, name });
    }
    case 'calibration.set.delete':
      return { ok: true, edit: { remove: set } };
    case 'calibration.source.add': {
      if (set.sources.some((s) => sameStint(s, action.source))) return reject('the set already holds this stint');
      const problem = sourceProblem(action.source, ctx.sessionsOnTrack(set.trackId), set.trackId);
      if (problem !== undefined) return reject(problem);
      const excludedLaps = [...new Set(action.source.excludedLaps)].sort((a, b) => a - b);
      return write({ ...set, sources: [...set.sources, { ...action.source, excludedLaps }] });
    }
    case 'calibration.source.remove': {
      if (!set.sources.some((s) => sameStint(s, action.source))) return reject('the set does not hold this stint');
      return write({ ...set, sources: set.sources.filter((s) => !sameStint(s, action.source)) });
    }
    case 'calibration.lap.exclude':
    case 'calibration.lap.include': {
      const at = set.sources.findIndex((s) => sameStint(s, action.source));
      const source = set.sources[at];
      if (source === undefined) return reject('the set does not hold this stint');
      const excluding = action.kind === 'calibration.lap.exclude';
      if (excluding === source.excludedLaps.includes(action.lap)) return reject(`lap ${action.lap} is ${excluding ? 'already' : 'not'} excluded`);
      if (excluding && !lapOfStint(source, action.lap, ctx.sessionsOnTrack(set.trackId))) return reject(`lap ${action.lap} is not a lap of this stint`);
      const excludedLaps = excluding ? [...source.excludedLaps, action.lap].sort((a, b) => a - b) : source.excludedLaps.filter((l) => l !== action.lap);
      return write({ ...set, sources: set.sources.with(at, { ...source, excludedLaps }) });
    }
    case 'calibration.override.set': {
      const entry = ctx.entry(action.key);
      if (entry === undefined) return reject(`no priors entry "${action.key}"`);
      const [min, max] = entry.range;
      if (!(action.value >= min && action.value <= max)) return reject(`${action.key} must lie in [${min}, ${max}]`);
      return write({ ...set, overrides: { ...set.overrides, [action.key]: action.value } });
    }
    case 'calibration.override.clear': {
      if (!Object.hasOwn(set.overrides, action.key)) return reject(`no override of "${action.key}"`);
      const { [action.key]: _cleared, ...overrides } = set.overrides;
      return write({ ...set, overrides });
    }
  }
}

function nameProblem(name: string, trackId: number, sets: readonly CalibrationSet[]): string | undefined {
  if (name === '') return 'a set needs a name';
  return sets.some((s) => s.trackId === trackId && s.name === name) ? `track ${trackId} already has a set "${name}"` : undefined;
}

/** Why `source` cannot be a source of a set on `trackId`: a stint of a stored session on the track, of our cars (spec 3.1). */
function sourceProblem(source: CalibrationSource, sessions: readonly TrackSession[], trackId: number): string | undefined {
  const session = sessions.find((s) => s.sessionUid === source.sessionUid && s.weekendId === source.weekendId && s.playerCar === source.feedCar);
  if (session === undefined) return `no stored session ${source.sessionUid} of car ${source.feedCar} on track ${trackId}`;
  if (session.stale || session.projection === undefined) return `session ${source.sessionUid} awaits a rebuild`;
  if (!ourCars(session).includes(source.car)) return `car ${source.car} is neither the feed's player car nor its teammate`;
  const stint = session.projection.stints.find((s) => s.carId === source.car && s.firstLap === source.firstLap);
  if (stint === undefined) return `no stint of car ${source.car} starts at lap ${source.firstLap}`;
  if (source.excludedLaps.some((l) => l < stint.firstLap || l > stint.lastLap)) return 'an excluded lap is not a lap of this stint';
  return undefined;
}

/** Whether `lap` lies in the source's stint; when the stint cannot be read now (missing, stale), from its first lap on. */
function lapOfStint(source: CalibrationSource, lap: number, sessions: readonly TrackSession[]): boolean {
  const session = sessions.find((s) => s.sessionUid === source.sessionUid && s.weekendId === source.weekendId && s.playerCar === source.feedCar);
  const stint = session?.projection?.stints.find((s) => s.carId === source.car && s.firstLap === source.firstLap);
  return lap >= source.firstLap && (stint === undefined || lap <= stint.lastLap);
}
