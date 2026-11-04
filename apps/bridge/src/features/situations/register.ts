import { bindSituation, defineFeature } from '../feature.ts';

/**
 * The situation topics (C20, C53–C55): one core topic per sub-machine, `situation.<camelMachineId>`, carrying its open
 * spans as they are. No calculator: the hub reads the spans when it sends a value.
 */
export default defineFeature({
  name: 'situations',
  calculators: [],
  topics: [
    bindSituation('situation.clock', 'clock'),
    bindSituation('situation.weekendPhase', 'weekend-phase'),
    bindSituation('situation.carLocation', 'car-location'),
    bindSituation('situation.carStatus', 'car-status'),
    bindSituation('situation.carFlags', 'car-flags'),
    bindSituation('situation.warnings', 'warnings'),
    bindSituation('situation.lapValidity', 'lap-validity'),
    bindSituation('situation.zoneFlags', 'zone-flags'),
    bindSituation('situation.sessionPhaseRace', 'session-phase-race'),
    bindSituation('situation.sessionPhaseQualifying', 'session-phase-qualifying'),
    bindSituation('situation.sessionPhasePractice', 'session-phase-practice'),
    bindSituation('situation.raceControlRace', 'race-control-race'),
    bindSituation('situation.raceControlQualifying', 'race-control-qualifying'),
    bindSituation('situation.raceControlPractice', 'race-control-practice'),
    bindSituation('situation.carActivityRace', 'car-activity-race'),
    bindSituation('situation.carActivityQualifying', 'car-activity-qualifying'),
    bindSituation('situation.carActivityPractice', 'car-activity-practice'),
    bindSituation('situation.penalties', 'penalties'),
    bindSituation('situation.compoundRule', 'compound-rule'),
  ],
});
