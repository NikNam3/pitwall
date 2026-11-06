import { carId, known, unknown, type BrakingZone, type Metres, type TrackData } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { TALK_WINDOW, TALK_WINDOW_BEHAVIOUR, TALK_WINDOW_CONFIG } from '../../src/talk-window/index.ts';
import { talkWindowCalculator } from '../../src/talk-window/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedQuick, openSpan, situatedView } from '../situated.ts';

/** The calculator through its guarded view (C41). */
const calc = guardedQuick(talkWindowCalculator);

const LENGTH = 5000;
/** One braking zone from 2500 m to 2600 m, and one that starts 50 m after the line (fraction 0.01 to 0.03). */
const MIDDLE: BrakingZone = { start: 0.5, end: 0.52 };
const AFTER_LINE: BrakingZone = { start: 0.01, end: 0.03 };

/** The default car's dynamics at `speedKmh`. */
const at = (speedKmh: number) => {
  const d = carState().dynamics;
  return known({ ...(d.known ? d.value : (() => { throw new Error('no dynamics'); })()), speedKmh }, 0);
};

/** A hand-made track whose braking zones are exactly `zones` (the rest is Zandvoort's, which nothing here reads). */
const trackWith = (zones: TrackData['brakingZones']): EngineView['track'] => known({ ...zandvoortTrack(), brakingZones: zones }, 0);

type Setup = {
  speedKmh?: number;
  distanceM?: Metres;
  location?: 'garage' | 'pitLane' | 'track';
  track?: EngineView['track'];
  trackLengthM?: Metres;
  config?: EngineView['config'];
  rival?: boolean;
};

const viewOf = ({ speedKmh = 300, distanceM = 0, location = 'track', track = trackWith(known([MIDDLE, AFTER_LINE], 0)), trackLengthM = LENGTH, config = {}, rival = false }: Setup = {}): EngineView =>
  situatedView({
    cars: [
      carState({ id: carId(0), timing: { lapDistanceM: distanceM }, dynamics: at(speedKmh) }),
      ...(rival ? [carState({ id: carId(5), timing: { lapDistanceM: 2550 }, dynamics: at(speedKmh) })] : []),
    ],
    spans: [openSpan('car-location', location, { car: 0 }), ...(rival ? [openSpan('car-location', 'track', { car: 5 })] : [])],
    session: { trackLengthM },
    track,
    config,
    playerCar: 0,
  });

const talk = (setup: Setup) => calc.compute(viewOf(setup))[carId(0)]?.talk;
const busy = { known: true, value: 'busy' };
const clear = { known: true, value: 'clear' };

describe('talk-window calculator', () => {
  it('is the quick calculator `talk-window` per frame over timing, speed, the session and car-location', () => {
    expect(talkWindowCalculator.id).toBe(TALK_WINDOW);
    expect(talkWindowCalculator.kind).toBe('quick');
    expect(talkWindowCalculator.cadence).toBe('frame');
    expect(talkWindowCalculator.reads).toEqual(expect.arrayContaining(['timing', 'spans:car-location']));
  });

  it('the lead is 1.5 s by default', () => {
    expect(TALK_WINDOW_CONFIG.defaults.leadS).toBe(1.5);
  });

  it('inside a braking zone: busy', () => {
    expect(talk({ distanceM: 2550, speedKmh: 100 })).toMatchObject(busy);
  });

  it('at 300 km/h the lead is 125 m: 120 m before a zone is busy, 130 m before is clear', () => {
    expect(talk({ distanceM: 2500 - 120 })).toMatchObject(busy);
    expect(talk({ distanceM: 2500 - 130 })).toMatchObject(clear);
  });

  it('the lead follows the speed and the config', () => {
    expect(talk({ distanceM: 2500 - 120, speedKmh: 150 })).toMatchObject(clear);
    expect(talk({ distanceM: 2500 - 130, config: { [TALK_WINDOW_CONFIG.key]: { leadS: 3 } } })).toMatchObject(busy);
  });

  it('well clear of every zone: clear', () => {
    expect(talk({ distanceM: 1500 })).toMatchObject(clear);
  });

  it('on the last metres of the lap before a zone that starts after the line: busy', () => {
    // 20 m to the line, the zone starts 50 m after it: 70 m ahead, within the 125 m lead
    expect(talk({ distanceM: LENGTH - 20 })).toMatchObject(busy);
    expect(talk({ distanceM: LENGTH - 20, speedKmh: 100 })).toMatchObject(busy);
  });

  it('in the pit lane: clear, even where a zone is; in the garage: notApplicable', () => {
    expect(talk({ location: 'pitLane', distanceM: 2550 })).toMatchObject(clear);
    expect(talk({ location: 'garage', distanceM: 2550 })).toEqual({ known: false, reason: 'notApplicable' });
  });

  it('without a track file: notApplicable', () => {
    expect(talk({ track: unknown('notApplicable'), distanceM: 2550 })).toEqual({ known: false, reason: 'notApplicable' });
  });

  it('with unknown braking zones: notApplicable', () => {
    expect(talk({ track: trackWith(unknown('notApplicable')), distanceM: 2550 })).toEqual({ known: false, reason: 'notApplicable' });
  });

  it('a track length of 0: insufficientData', () => {
    expect(talk({ trackLengthM: 0, distanceM: 2550 })).toEqual({ known: false, reason: 'insufficientData' });
  });

  it('a rival has no entry', () => {
    const out = calc.compute(viewOf({ rival: true }));
    expect(Object.keys(out)).toEqual(['0']);
    expect(out[carId(5)]).toBeUndefined();
  });

  it('its behaviour table has the three kinds of car-location', () => {
    expect(Object.keys(TALK_WINDOW_BEHAVIOUR['car-location']!).sort()).toEqual(['garage', 'pitLane', 'track']);
  });
});
