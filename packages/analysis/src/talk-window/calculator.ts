// The `talk-window` calculator (spec 6.3): per car of ours, `busy` while the car is in or about to reach a braking zone.
import { known, unknown, type CarId, type TalkWindow } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { behaviourFor } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { brakingAhead, fractionOf } from '../shared/track-lookup.ts';
import { TALK_WINDOW_BEHAVIOUR } from './behaviour.ts';
import { TALK_WINDOW_CONFIG } from './config.ts';
import { TALK_WINDOW } from './index.ts';
import type { TalkWindowOutput } from './index.ts';

/** One car's window. */
function windowOf(view: EngineView, id: CarId, leadS: number): TalkWindow {
  const car = view.live.cars[id];
  const at = view.live.sessionTime;
  if (car === undefined) return { talk: unknown('notReceived') };
  const rows = behaviourFor(TALK_WINDOW_BEHAVIOUR, view, id);
  if (rows.some((row) => row.talk === 'notApplicable')) return { talk: unknown('notApplicable') };
  if (rows.some((row) => row.talk === 'clear')) return { talk: known('clear', at) };
  if (!view.track.known) return { talk: unknown('notApplicable') };
  const zones = view.track.value.brakingZones;
  if (!zones.known) return { talk: unknown('notApplicable') };
  const lengthM = view.live.session.trackLengthM;
  const fraction = fractionOf(car.timing.lapDistanceM, lengthM);
  if (fraction === undefined) return { talk: unknown('insufficientData') };
  if (!car.dynamics.known) return { talk: unknown(car.dynamics.reason) };
  const state = brakingAhead(zones.value, fraction, lengthM, (car.dynamics.value.speedKmh / 3.6) * leadS);
  return { talk: known(state === 'clear' ? 'clear' : 'busy', at) };
}

/** Whether each of our cars is in or just before a braking zone, at its speed now. */
export const talkWindowCalculator: QuickCalculator<TalkWindowOutput> = {
  id: TALK_WINDOW,
  kind: 'quick',
  reads: ['identity', 'timing', 'dynamics', 'session', 'spans:car-location'],
  cadence: 'frame',
  compute: (view): TalkWindowOutput => {
    const { leadS } = TALK_WINDOW_CONFIG.read(view);
    const out: TalkWindowOutput = {};
    for (const id of ourCars(view.live)) out[id] = windowOf(view, id, leadS);
    return out;
  },
};
