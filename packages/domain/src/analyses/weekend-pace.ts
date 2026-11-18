// Value type of the `weekend-pace` calculator (SP4.3d2 Task 6b): per car its race pace before its first race lap, from
// its practice long runs (`longRun`) or its qualifying best (`qualifying`), with the laps it rests on.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

export type WeekendPace = Record<CarId, Known<{ paceMs: Ms; sdMs: Ms; source: 'longRun' | 'qualifying' | 'standIn'; laps: number }>>;
