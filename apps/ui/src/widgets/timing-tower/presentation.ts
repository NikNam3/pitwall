// The timing tower's presentation table (contract C66): every kind of each sub-machine it reads to what its rows show,
// and every moment of `raceMoment.current` to the emphasis of the rows the moment names.
//  - weekend-phase: which car-activity topic the situation column reads (none while no activity machine runs);
//  - car-status: whether the row shows, among the running cars or sunk below them, and its code;
//  - car-location: the situation code of where the car is;
//  - car-activity-<phase>: the situation code of what the car does (its own, the location's, or the served penalty's);
//  - penalties: what the PEN cell shows; warnings: whether it shows the warning count.
import type {
  Moment, ServingPenaltyDetail, carActivityPracticeSpans, carActivityQualifyingSpans, carActivityRaceSpans, carLocationSpans,
  carStatusSpans, penaltiesSpans, warningsSpans, weekendPhaseSpans,
} from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import type { Role } from '../../theme/roles.ts';
import * as text from './text.ts';

type KindOf<D extends { kinds: readonly string[] }> = D['kinds'][number];
type LocationKind = KindOf<typeof carLocationSpans>;

/** A cell of the situation column as it shows: its code and role. */
export type SituationCell = { readonly text: string; readonly role?: Role | undefined };

/** The tower's data keys of the three car-activity topics. */
export type ActivityKey = 'raceActivity' | 'qualifyingActivity' | 'practiceActivity';
/** A weekend phase's row: the car-activity topic of its phase; `undefined` where no activity machine runs. */
export type PhaseRow = { readonly activity: ActivityKey | undefined };

/** A car status's row: `hidden` (no row), `running` (by position) or `out` (below the running cars, with its code). */
export type StatusRow = { readonly row: 'hidden' } | { readonly row: 'running' } | { readonly row: 'out'; readonly cell: SituationCell };

/**
 * A car activity's row: a code of its own; the location's code (`byLocation`, the activity's code on track); or the
 * code of the penalty it serves (`ServingPenaltyDetail.penalty`).
 */
export type ActivityRow =
  | { readonly cell: SituationCell }
  | { readonly byLocation: Readonly<Record<LocationKind, SituationCell>> }
  | { readonly byPenalty: Readonly<Record<ServingPenaltyDetail['penalty'], SituationCell>> };

/** A penalties row: the PEN cell shows the warnings, the time penalty, or the drive-through or stop-go to serve. */
export type PenaltyRow = { readonly pen: 'warnings' | 'timePenalty' | 'toServe' };
/** A warnings row: whether the PEN cell shows the warning count (when no penalty stands). */
export type WarningsRow = { readonly count: boolean };
/** A moment's row: the role of the rows the moment names (the left bar); `undefined` lights nothing. */
export type MomentRow = { readonly emphasis: Role | undefined };

const cell = (code: string, role?: Role): SituationCell => (role === undefined ? { text: code } : { text: code, role });

const NONE = cell(text.situation.none);
const GARAGE = cell(text.situation.garage);
const FIN = cell(text.situation.finished);
/** Where the car is: GARAGE, PIT, or nothing on track. */
const LOCATION: Readonly<Record<LocationKind, SituationCell>> = { garage: GARAGE, pitLane: cell(text.situation.pit), track: NONE };
const onTrack = (code: string): ActivityRow => ({ byLocation: { ...LOCATION, track: cell(code) } });
const AT_LOCATION: ActivityRow = { byLocation: LOCATION };

type Rows<D extends { kinds: readonly string[] }, R> = Readonly<Record<KindOf<D>, R>>;
type TowerTable = PresentationTable & {
  situations: {
    'weekend-phase': Rows<typeof weekendPhaseSpans, PhaseRow>;
    'car-status': Rows<typeof carStatusSpans, StatusRow>;
    'car-location': Rows<typeof carLocationSpans, SituationCell>;
    'car-activity-race': Rows<typeof carActivityRaceSpans, ActivityRow>;
    'car-activity-qualifying': Rows<typeof carActivityQualifyingSpans, ActivityRow>;
    'car-activity-practice': Rows<typeof carActivityPracticeSpans, ActivityRow>;
    penalties: Rows<typeof penaltiesSpans, PenaltyRow>;
    warnings: Rows<typeof warningsSpans, WarningsRow>;
  };
  moments: Readonly<Record<Moment, MomentRow>>;
};

export const presentation: TowerTable = {
  situations: {
    'weekend-phase': {
      race: { activity: 'raceActivity' },
      qualifying: { activity: 'qualifyingActivity' },
      practice: { activity: 'practiceActivity' },
      none: { activity: undefined },
    },
    'car-status': {
      competing: { row: 'running' },
      retired: { row: 'out', cell: cell(text.situation.retired) },
      disqualified: { row: 'out', cell: cell(text.situation.disqualified) },
      absent: { row: 'hidden' },
    },
    'car-location': LOCATION,
    'car-activity-race': {
      racingLap: AT_LOCATION,
      // in the pit lane on an in or out lap: PIT
      inLap: onTrack(text.situation.in),
      boxStop: { cell: cell(text.situation.box) },
      servingPenalty: { byPenalty: { driveThrough: cell(text.situation.driveThrough, 'warning'), stopGo: cell(text.situation.stopGo, 'warning') } },
      outLap: onTrack(text.situation.out),
      // FIN also in the pit lane
      finished: { cell: FIN },
      coolDown: { cell: FIN },
      // the car status's code decides; a car competing again shows where it is
      notCompeting: AT_LOCATION,
    },
    'car-activity-qualifying': {
      outLap: onTrack(text.situation.out),
      pushLap: AT_LOCATION,
      inLap: onTrack(text.situation.in),
      garage: { cell: GARAGE },
      finished: { cell: FIN },
      notCompeting: AT_LOCATION,
    },
    'car-activity-practice': {
      outLap: onTrack(text.situation.out),
      flyingLap: AT_LOCATION,
      inLap: onTrack(text.situation.in),
      garage: { cell: GARAGE },
      finished: { cell: FIN },
      notCompeting: AT_LOCATION,
    },
    penalties: {
      clear: { pen: 'warnings' },
      timePenalty: { pen: 'timePenalty' },
      driveThroughPending: { pen: 'toServe' },
      stopGoPending: { pen: 'toServe' },
    },
    warnings: {
      noWarning: { count: false },
      warned: { count: true },
    },
  },
  moments: {
    neutralised: { emphasis: undefined },
    incident: { emphasis: 'warning' },
    window: { emphasis: undefined },
    weather: { emphasis: undefined },
    battle: { emphasis: undefined },
    carCare: { emphasis: undefined },
  },
};
