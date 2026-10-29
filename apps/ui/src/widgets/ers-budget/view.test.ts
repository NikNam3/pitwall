import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { ErsState } from '@pitwall/domain';
import { ersView } from './view.ts';

const at = toSessionTime(10);
const MJ = 1_000_000;
const state = (over: Partial<ErsState> = {}): ErsState => ({
  storeJ: known(1.9 * MJ, at),
  capacityJ: 4 * MJ,
  deployedThisLapJ: known(2.1 * MJ, at),
  deployLimitJ: 4 * MJ,
  harvestedThisLapJ: known(1.3 * MJ, at),
  storeTrendJPerLap: known(0.4 * MJ, at),
  attackLevelJ: 2.5 * MJ,
  lapsToAttackLevel: known(1.5, at),
  attack: known({ ready: false, inLaps: 2 }, at),
  mode: known('medium', at),
  flow: known('harvesting', at),
  ...over,
});

describe('ersView: store row', () => {
  it('hands the bar its value, range and attack-level limit in joules', () => {
    const v = ersView(state());
    expect(v.bar).toEqual({ value: known(1.9 * MJ, at), min: 0, max: 4 * MJ, limit: 2.5 * MJ });
    expect(v.store).toBe('1.9 MJ');
    expect(v.level).toBe('2.5 MJ');
  });

  it('has empty store text and the reason for an unknown store', () => {
    const v = ersView(state({ storeJ: unknown('realism') }));
    expect(v.store).toBe('');
    expect(v.bar.value).toEqual(unknown('realism'));
    expect(v.reasons.store).toBe('realism');
  });

  it('has no reason for a known store', () => {
    expect(ersView(state()).reasons.store).toBeUndefined();
  });
});

describe('ersView: flow arrow', () => {
  it('is ▼ deploying while deploying', () => {
    expect(ersView(state({ flow: known('deploying', at) })).flow).toBe('▼ deploying');
  });

  it('is ▲ harvesting while harvesting', () => {
    expect(ersView(state({ flow: known('harvesting', at) })).flow).toBe('▲ harvesting');
  });

  it('is empty when idle', () => {
    expect(ersView(state({ flow: known('idle', at) })).flow).toBe('');
  });

  it('is empty when unknown, with the reason', () => {
    const v = ersView(state({ flow: unknown('notReceived') }));
    expect(v.flow).toBe('');
    expect(v.reasons.flow).toBe('notReceived');
  });

  it('does not show the deploy mode anywhere', () => {
    expect(JSON.stringify(ersView(state({ mode: known('overtake', at) })))).not.toContain('overtake');
  });
});

describe('ersView: deploy and harvest rows', () => {
  it('shows the lap total with the per-lap limit (not the battery) as plain MJ number', () => {
    const v = ersView(state({ deployLimitJ: 4 * MJ }));
    expect(v.deployed).toBe('2.1 MJ');
    expect(v.deployLimit).toBe('4.0');
    expect(v.harvested).toBe('1.3 MJ');
  });

  it('keeps the limit when the deployed value is unknown; the reason is on the cell', () => {
    const v = ersView(state({ deployedThisLapJ: unknown('notReceived'), harvestedThisLapJ: unknown('realism') }));
    expect(v.deployed).toBe('');
    expect(v.deployLimit).toBe('4.0');
    expect(v.harvested).toBe('');
    expect(v.reasons.deployed).toBe('notReceived');
    expect(v.reasons.harvested).toBe('realism');
  });
});

describe('ersView: trend and attack text', () => {
  it('shows a rising trend with + and a real minus sign for a falling one, per lap', () => {
    expect(ersView(state()).trend).toBe('+0.4 MJ/lap');
    expect(ersView(state({ storeTrendJPerLap: known(-0.3 * MJ, at) })).trend).toBe('−0.3 MJ/lap');
  });

  it('shows a flat trend without a sign', () => {
    expect(ersView(state({ storeTrendJPerLap: known(0, at) })).trend).toBe('0.0 MJ/lap');
  });

  it('has an empty trend and the reason when the trend is unknown', () => {
    const v = ersView(state({ storeTrendJPerLap: unknown('insufficientData') }));
    expect(v.trend).toBe('');
    expect(v.reasons.trend).toBe('insufficientData');
  });

  it('says "attack ready" when the analysis says ready', () => {
    const v = ersView(state({ storeJ: known(2.9 * MJ, at), storeTrendJPerLap: known(-0.3 * MJ, at), attack: known({ ready: true }, at) }));
    expect(v.attack).toBe('attack ready');
    expect(v.attackReady).toBe(true);
  });

  it('is not ready when the analysis says not ready', () => {
    expect(ersView(state({ attack: known({ ready: false, inLaps: 1 }, at) })).attackReady).toBe(false);
  });

  it('says "attack in N laps" with the analysis`s whole laps', () => {
    expect(ersView(state({ attack: known({ ready: false, inLaps: 2 }, at) })).attack).toBe('attack in 2 laps');
    expect(ersView(state({ attack: known({ ready: false, inLaps: 1 }, at) })).attack).toBe('attack in 1 lap');
  });

  it('says nothing when the attack is not applicable (falling or flat below the level)', () => {
    const v = ersView(state({ storeTrendJPerLap: known(-0.2 * MJ, at), lapsToAttackLevel: unknown('notApplicable'), attack: unknown('notApplicable') }));
    expect(v.attack).toBe('');
    expect(v.attackReady).toBe(false);
  });

  it('says nothing when the attack is unknown', () => {
    expect(ersView(state({ attack: unknown('insufficientData') })).attack).toBe('');
    const v = ersView(state({ storeJ: unknown('realism'), attack: unknown('realism') }));
    expect(v.attack).toBe('');
    expect(v.attackReady).toBe(false);
  });
});

describe('ersView: trend line', () => {
  it('joins trend and attack with a separator', () => {
    const v = ersView(state({ attack: known({ ready: true, inLaps: 0 }, at) }));
    expect(v.trend).toBe('+0.4 MJ/lap');
    expect(v.attack).toBe('attack ready');
    expect(v.trendJoint).toBe(',\u00a0');
  });

  it('has no separator when the trend is empty and the attack shows', () => {
    const v = ersView(state({ storeTrendJPerLap: unknown('notReceived'), attack: known({ ready: true, inLaps: 0 }, at) }));
    expect(v.trend).toBe('');
    expect(v.trendJoint).toBe('');
  });

  it('has no separator when there is no attack text', () => {
    expect(ersView(state({ attack: unknown('notReceived') })).trendJoint).toBe('');
  });

  it('prints a falling trend with the true minus and the limit in MJ', () => {
    const v = ersView(state({ storeTrendJPerLap: known(-0.4 * MJ, at) }));
    expect(v.trend).toBe('−0.4 MJ/lap');
    expect(v.deployLimit).toBe('4.0');
  });
});
