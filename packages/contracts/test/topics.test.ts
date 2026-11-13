import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CarDynamics, CarId, CarMotion, CarState, FeedId, GapperReference, Interval, Known, LapRecord, OpenSpan, RaceMoment } from '@pitwall/domain';
import type { CarTelemetry } from '../src/topics/car.telemetry.ts';
import {
  CONTRACT_VERSION,
  TOPICS,
  type CarOverview,
  type FeedInfo,
  type FeedStatus,
  type InsightEntry,
  type MachineSpans,
  type PitStopCounts,
  type ReplayJump,
  type ReplayStatus,
  type ReservedCommand,
  type SessionInfo,
  type TopicName,
  type TopicParams,
  type TopicValue,
} from '../src/index.ts';
import { carId, SPAN_DECLARATIONS } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams, type TopicOwner } from '../src/topic-def.ts';
import carDetail from '../src/topics/car.detail.ts';
import laps from '../src/topics/laps.ts';

describe('TOPICS', () => {
  it('has exactly the 13 feed topics besides the situation topics (spec 8.4, replay.status of 8.5, calibration.active of SP4.1a, config.effective of SP4.3b) with their modes and rates', () => {
    const table = Object.entries(TOPICS)
      .filter(([key, d]) => d.scope === 'feed' && d.owner === 'core' && !key.startsWith('situation.'))
      .map(([key, d]) => [key, d.name, d.mode, d.maxHz] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(table).toEqual([
      ['calibration.active', 'calibration.active', 'state', Infinity],
      ['car.detail', 'car.detail', 'state', 30],
      ['car.telemetry', 'car.telemetry', 'state', 60],
      ['cars.overview', 'cars.overview', 'state', 10],
      ['config.effective', 'config.effective', 'state', Infinity],
      ['events', 'events', 'append', Infinity],
      ['feed.status', 'feed.status', 'state', 2],
      ['insights', 'insights', 'append', Infinity],
      ['laps', 'laps', 'append', Infinity],
      ['pitStops', 'pitStops', 'append', Infinity],
      ['replay.status', 'replay.status', 'state', 4],
      ['session.info', 'session.info', 'state', 2],
      ['stints', 'stints', 'append', Infinity],
    ]);
  });
  it('has one situation topic per sub-machine (C53, C54): situation.<camelMachineId>, core, feed, state, 4 Hz', () => {
    const camel = (machine: string) => machine.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const table = Object.entries(TOPICS)
      .filter(([key]) => key.startsWith('situation.'))
      .map(([key, d]) => [key, d.name, d.owner, d.scope, d.mode, d.maxHz] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(table).toEqual(
      SPAN_DECLARATIONS.map((d) => `situation.${camel(d.machine)}`)
        .sort()
        .map((name) => [name, name, 'core', 'feed', 'state', 4]),
    );
    expect(table).toHaveLength(20);
  });
  it('gives every core topic outside dev, ui, the calibration store\'s and the profile module\'s scope feed', () => {
    const core = Object.entries(TOPICS).filter(([name, d]) => d.owner === 'core' && !/^(dev|ui)\./.test(name) && !['calibration.sets', 'calibration.values', 'calibration.candidates', 'drivers.profiles', 'drivers.links'].includes(name));
    expect(core).toHaveLength(13 + 20);
    for (const [, d] of core) expect(d.scope).toBe('feed');
  });
  it.each(['calibration.sets', 'calibration.values', 'calibration.candidates'] as const)('has the global topic %s of the calibration store (C54, C62a): owner core, state', (name) => {
    expect(TOPICS[name]).toMatchObject({ name, owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
  });
  it('has the analysis topics of sub-project 3 (spec A.3), SP4.1a and SP4.1b: owner, mode and rate', () => {
    const table = Object.entries(TOPICS)
      .filter(([, d]) => d.owner !== 'core')
      .map(([key, d]) => [key, d.owner, d.scope, d.mode, d.maxHz] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(table).toEqual([
      ['battle.cards', 'battle', 'feed', 'state', 4],
      ['carBands.car', 'car-bands', 'feed', 'state', 4],
      ['crossover.car', 'crossover', 'feed', 'state', 1],
      ['damage.car', 'damage', 'feed', 'state', 4],
      ['ers.car', 'ers', 'feed', 'state', 4],
      ['forecastScore.report', 'forecast-score', 'feed', 'state', 1],
      ['fuel.car', 'fuel', 'feed', 'state', 4],
      ['gaps.gapper', 'gaps', 'feed', 'state', 4],
      ['gaps.intervals', 'gaps', 'feed', 'state', 4],
      ['gaps.neighbourhood', 'gaps', 'feed', 'state', 2],
      ['gaps.toCar', 'gaps', 'feed', 'state', 4],
      ['incidents.feed', 'incidents', 'feed', 'state', 4],
      ['incidents.markers', 'incidents', 'feed', 'state', 1],
      ['lapOverview.car', 'lap-overview', 'feed', 'state', 1],
      ['lapTimes.board', 'lap-times', 'feed', 'state', 4],
      ['lapTimes.projection', 'lap-times', 'feed', 'state', 10],
      ['pitLosses.track', 'pit-losses', 'feed', 'state', 1],
      ['pitStopCount.byCar', 'pit-stop-count', 'feed', 'state', 4],
      ['pitSweep.car', 'pit-sweep', 'feed', 'state', 1],
      ['pitWindow.car', 'pit-window', 'feed', 'state', 4],
      ['raceMoment.current', 'race-moment', 'feed', 'state', 4],
      ['raisingAverage.field', 'raising-average', 'feed', 'state', 1],
      ['rejoin.car', 'rejoin', 'feed', 'state', 4],
      ['rejoin.ghostLines', 'rejoin', 'feed', 'state', 4],
      ['scCall.car', 'sc-call', 'feed', 'state', 1],
      ['stintAnalysis.car', 'stint-analysis', 'feed', 'state', 1],
      ['strategy.car', 'strategy', 'feed', 'state', 1],
      ['strategy.plans', 'strategy', 'feed', 'state', 1],
      ['talkWindow.car', 'talk-window', 'feed', 'state', 10],
      ['trackPositions.cars', 'track-positions', 'feed', 'state', 10],
      ['trackPositions.geometry', 'track-positions', 'feed', 'state', 1],
      ['tyreWear.car', 'tyre-wear', 'feed', 'state', 4],
      ['undercut.car', 'undercut', 'feed', 'state', 1],
      ['weather.forecast', 'weather', 'feed', 'state', 1],
    ]);
  });
  it('has the global topic dev.calcStats: owner core, state, 1 Hz', () => {
    expect(TOPICS['dev.calcStats']).toMatchObject({ name: 'dev.calcStats', owner: 'core', scope: 'global', mode: 'state', maxHz: 1 });
  });
  it('has the global topic dev.catalogue: owner core, state', () => {
    expect(TOPICS['dev.catalogue']).toMatchObject({ name: 'dev.catalogue', owner: 'core', scope: 'global', mode: 'state' });
  });
  it.each(['ui.workbooks', 'ui.linkGroups', 'ui.alerts', 'ui.settings'] as const)('has the global topic %s: owner core, state', (name) => {
    expect(TOPICS[name]).toMatchObject({ name, owner: 'core', scope: 'global', mode: 'state' });
  });
  // M7-R: cars.overview lost `stops`, pitStopCount.byCar is new
  it('exports the contract version', () => { expect(CONTRACT_VERSION).toBe(12); });
});

describe('defineTopic', () => {
  it('returns owner, mode and rate without a name, scope defaulting to feed', () => {
    expect(defineTopic<Record<string, never>, number>({ owner: 'core', mode: 'state', maxHz: 5 })).toEqual({ owner: 'core', mode: 'state', maxHz: 5, scope: 'feed' });
  });
  it('keeps an explicit global scope and a non-core owner', () => {
    expect(defineTopic<Record<string, never>, number>({ owner: 'ui', mode: 'state', maxHz: 5, scope: 'global' })).toEqual({ owner: 'ui', mode: 'state', maxHz: 5, scope: 'global' });
    expectTypeOf<TopicOwner>().toEqualTypeOf<'core' | (string & {})>();
  });
  it('does not compile without an owner', () => {
    // @ts-expect-error owner is required
    const noOwner = defineTopic<Record<string, never>, number>({ mode: 'state', maxHz: 5 });
    expect(noOwner.mode).toBe('state');
  });
  it('is what each topic file default-exports', () => {
    expect(carDetail).toEqual({ owner: 'core', mode: 'state', maxHz: 30, scope: 'feed', momentParams: eachCar });
    expect(laps).toEqual({ owner: 'core', mode: 'append', maxHz: Infinity, scope: 'feed' });
  });
  it('requires momentParams exactly for a topic with params', () => {
    // @ts-expect-error a topic with params must say which params a moment captures
    const missing = defineTopic<CarParams, number>({ owner: 'core', mode: 'state', maxHz: 5 });
    // @ts-expect-error a topic without params is captured with {} only
    const extra = defineTopic<Record<string, never>, number>({ owner: 'core', mode: 'state', maxHz: 5, momentParams: eachCar });
    expect([missing.mode, extra.mode]).toEqual(['state', 'state']);
  });
  it('eachCar gives one { carId } per car, in order', () => {
    expect(eachCar([carId(3), carId(0)])).toEqual([{ carId: 3 }, { carId: 0 }]);
  });
});

describe('topic types', () => {
  it('keep TopicName, TopicParams and TopicValue', () => {
    expectTypeOf<TopicName>().toEqualTypeOf<
      | 'feed.status' | 'session.info' | 'cars.overview' | 'car.detail' | 'car.telemetry' | 'laps'
      | 'stints' | 'pitStops' | 'events' | 'insights' | 'dev.calcStats' | 'dev.catalogue'
      | 'replay.status' | 'ui.workbooks' | 'ui.linkGroups' | 'ui.alerts' | 'ui.settings'
      | 'tyreWear.car' | 'fuel.car' | 'ers.car' | 'carBands.car' | 'damage.car' | 'gaps.intervals' | 'gaps.toCar'
      | 'gaps.gapper' | 'gaps.neighbourhood' | 'lapTimes.board' | 'lapTimes.projection' | 'battle.cards'
      | 'incidents.feed' | 'incidents.markers' | 'raceMoment.current' | 'pitStopCount.byCar'
      | 'trackPositions.geometry' | 'trackPositions.cars' | 'talkWindow.car'
      | 'stintAnalysis.car' | 'pitLosses.track'
      | 'raisingAverage.field' | 'lapOverview.car' | 'weather.forecast' | 'crossover.car'
      | 'rejoin.car' | 'rejoin.ghostLines' | 'scCall.car' | 'pitWindow.car'
      | 'calibration.sets' | 'calibration.values' | 'calibration.candidates' | 'calibration.active'
      | 'drivers.profiles' | 'drivers.links' | 'forecastScore.report' | 'config.effective' | 'strategy.plans'
      | 'strategy.car' | 'undercut.car' | 'pitSweep.car'
      | 'situation.carActivityPractice' | 'situation.carActivityQualifying' | 'situation.carActivityRace' | 'situation.carFlags'
      | 'situation.carDriver' | 'situation.carLocation' | 'situation.carStatus' | 'situation.clock' | 'situation.compoundRule' | 'situation.lapValidity'
      | 'situation.penalties' | 'situation.raceControlPractice' | 'situation.raceControlQualifying' | 'situation.raceControlRace'
      | 'situation.sessionPhasePractice' | 'situation.sessionPhaseQualifying' | 'situation.sessionPhaseRace' | 'situation.warnings'
      | 'situation.weekendPhase' | 'situation.zoneFlags'
    >();
    expectTypeOf<MachineSpans>().toEqualTypeOf<{ open: OpenSpan[] }>();
    expectTypeOf<TopicValue<'situation.clock'>>().toEqualTypeOf<MachineSpans>();
    expectTypeOf<TopicValue<'situation.carActivityRace'>>().toEqualTypeOf<MachineSpans>();
    expectTypeOf<TopicParams<'situation.clock'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<TopicParams<'gaps.gapper'>>().toEqualTypeOf<{ reference: GapperReference }>();
    expectTypeOf<TopicParams<'lapTimes.board'>>().toEqualTypeOf<{ referenceCarId: CarId }>();
    expectTypeOf<TopicParams<'battle.cards'>>().toEqualTypeOf<{ carId: CarId }>();
    expectTypeOf<TopicValue<'gaps.intervals'>>().toEqualTypeOf<Interval[]>();
    expectTypeOf<TopicValue<'raceMoment.current'>>().toEqualTypeOf<Known<RaceMoment>>();
    expectTypeOf<TopicParams<'car.detail'>>().toEqualTypeOf<{ carId: CarId }>();
    expectTypeOf<TopicParams<'car.detail'>['carId']>().toEqualTypeOf<CarId>();
    expectTypeOf<TopicParams<'car.telemetry'>['carId']>().toEqualTypeOf<CarId>();
    expectTypeOf<TopicParams<'laps'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<TopicValue<'car.detail'>>().toEqualTypeOf<CarState>();
    expectTypeOf<TopicValue<'car.telemetry'>>().toEqualTypeOf<{ motion: CarMotion; dynamics: Known<CarDynamics> }>();
    expectTypeOf<TopicValue<'car.telemetry'>>().toEqualTypeOf<CarTelemetry>();
    expectTypeOf<TopicValue<'laps'>>().toEqualTypeOf<LapRecord>();
    expectTypeOf<TopicValue<'feed.status'>>().toEqualTypeOf<FeedStatus>();
    expectTypeOf<TopicValue<'session.info'>>().toEqualTypeOf<SessionInfo>();
    expectTypeOf<TopicValue<'cars.overview'>>().toEqualTypeOf<CarOverview[]>();
    expectTypeOf<TopicValue<'pitStopCount.byCar'>>().toEqualTypeOf<PitStopCounts>();
    expectTypeOf<TopicParams<'pitStopCount.byCar'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<PitStopCounts>().toEqualTypeOf<{ byCar: ReadonlyArray<{ carId: CarId; stops: number }> }>();
    expectTypeOf<TopicValue<'insights'>>().toEqualTypeOf<InsightEntry>();
    expectTypeOf<TopicValue<'replay.status'>>().toEqualTypeOf<ReplayStatus>();
    expectTypeOf<TopicParams<'replay.status'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<ReplayStatus>().toEqualTypeOf<{ paused: boolean; speed: number; sessionTimeMs: number; playerLap: number; atEnd: boolean; note?: 'beyondEnd'; unpaced?: true; jumpingTo?: ReplayJump }>();
    expectTypeOf<ReplayJump>().toEqualTypeOf<{ kind: 'lap'; lap: number } | { kind: 'time'; sessionTimeMs: number }>();
  });
  // M7-R (F2, C54): a core topic publishes live state as it is; the stop count is pit-stop-count's (pitStopCount.byCar)
  it('cars.overview carries no stop count', () => {
    expectTypeOf<CarOverview>().not.toHaveProperty('stops');
    expectTypeOf<keyof CarOverview>().toEqualTypeOf<'id' | 'identity' | 'timing' | 'tyres' | 'updatedAt'>();
  });
  it('carry what the UI needs to grey out stale values', () => {
    expectTypeOf<CarOverview['updatedAt']>().toEqualTypeOf<CarState['updatedAt']>();
    expectTypeOf<FeedStatus['cadenceMs']>().toEqualTypeOf<number | undefined>();
  });
  it('keep the moved DTO types importable from the package index', () => {
    expectTypeOf<FeedInfo['feedId']>().toEqualTypeOf<FeedId>();
    expectTypeOf<ReservedCommand['kind']>().toEqualTypeOf<'boxCall'>();
  });
});
