// Which slots hold a car of the session (contract C43): the one rule, car-status's (`situations/car-status/slots.ts`).
// car-status opens `absent` for a slot it gives false; the identity module's teammate imports the same rule. Task 24
// ruling 2 (C13): it reads the signals (`Signals`: each car's `resultStatus`, the session's `numActiveCars`), never the
// live state. `isActiveCar` ported from test/step/identity.test.ts (mechanical: its new home).
import { describe, expect, it } from 'vitest';
import type { ResultStatus } from '@pitwall/domain';
import { initialState } from '../../../src/index.ts';
import { readSignals } from '../../../src/signals/read.ts';
import { isActiveCar, slotsInUse } from '../../../src/situations/car-status/slots.ts';
import { ScenarioBuilder } from '../../builders/index.ts';
import { initFor } from '../../support/run.ts';

const slots = (numActiveCars: number, statuses: readonly ResultStatus[]) =>
  slotsInUse({ cars: statuses.map((resultStatus) => ({ resultStatus })), session: { numActiveCars } });

describe('car-status: the slots in use and the cars in the session', () => {
  it.each([['active', true], ['finished', true], ['retired', true], ['didNotFinish', true], ['invalid', false], ['inactive', false]] as const)(
    'isActiveCar: resultStatus %s -> %s', (rs, active) => {
      expect(isActiveCar(2, 3, rs)).toBe(active);
      expect(isActiveCar(3, 3, rs)).toBe(false);
    });
  it('slotsInUse: numActiveCars counts the cars still in the race; each car out of the race keeps its slot', () => {
    expect(slots(3, ['active', 'active', 'active', 'invalid'])).toBe(3);
    expect(slots(19, [...Array<ResultStatus>(2).fill('active'), 'retired', ...Array<ResultStatus>(17).fill('active'), 'invalid', 'invalid'])).toBe(20);
    expect(slots(1, ['disqualified', 'didNotFinish', 'notClassified', 'active'])).toBe(4);
  });
  it('slotsInUse: before the first Participants (numActiveCars 0) only the cars out of the race count', () => {
    expect(slots(0, ['active', 'active'])).toBe(0);
    expect(slots(0, ['retired', 'active'])).toBe(1);
  });
  it('slotsInUse reads the signals as step 1 wrote them: numActiveCars plus one slot per car out of the race', () => {
    const frame = new ScenarioBuilder({ cars: 6 }).participants({ numActiveCars: 4 }).frame((d) => {
      d.lapData.lapData[1]!.resultStatus = 7; // retired: keeps its slot
    }).build()[0]!;
    const signals = readSignals(frame, initialState(initFor([frame])).signals);
    expect(slotsInUse(signals)).toBe(5);
  });
});
