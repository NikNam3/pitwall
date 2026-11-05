// The live polish fields in their final form (plan Task 15): the interim fields the earlier tasks kept are gone, the
// fields they added are required, and a warning is a union by its kind. Type-level only (`pnpm typecheck` checks it).
import { describe, expectTypeOf, it } from 'vitest';
import type { BattleSide, DamageJump, GapperLines, IncidentWarning, Known, LapBoardRow, Ms, SectorStatus } from '../src/index.ts';

type GapperLine = GapperLines['cars'][number];
type Three<T> = [T, T, T];

describe('BattleSide', () => {
  it('has no CLOSING and no old overtaking margin', () => {
    expectTypeOf<BattleSide>().not.toHaveProperty('closingMsPerLap');
    expectTypeOf<BattleSide>().not.toHaveProperty('overtakeMarginMs');
  });

  it('has margin required: pass or hold with its ms', () => {
    expectTypeOf<Pick<BattleSide, 'margin'>>().toEqualTypeOf<{ margin: Known<{ kind: 'pass' | 'hold'; ms: Ms }> }>();
  });
});

describe('GapperLines.cars', () => {
  it('has no byLap', () => {
    expectTypeOf<GapperLine>().not.toHaveProperty('byLap');
  });

  it('has points required', () => {
    expectTypeOf<Pick<GapperLine, 'points'>>().toEqualTypeOf<{ points: { lap: number; gapMs: Ms }[] }>();
  });
});

describe('IncidentWarning', () => {
  it('is the union by kind: corner cutting with its count of the limit, other with its infringement and no count', () => {
    expectTypeOf<IncidentWarning>().toEqualTypeOf<
      { kind: 'cornerCutting'; count: number; limit: number } | { kind: 'other'; infringement: Known<number> }
    >();
  });
});

describe('LapBoardRow', () => {
  it('has the newest sectors, their status and whether each is older required', () => {
    expectTypeOf<Pick<LapBoardRow, 'newestSectorsMs' | 'newestSectorStatus' | 'newestSectorOlder'>>().toEqualTypeOf<{
      newestSectorsMs: Three<Known<Ms>>;
      newestSectorStatus: Three<SectorStatus>;
      newestSectorOlder: Three<boolean>;
    }>();
  });
});

describe('DamageJump', () => {
  it('has measuring and the estimate required', () => {
    expectTypeOf<Pick<DamageJump, 'measuring' | 'estimateMsPerLap'>>().toEqualTypeOf<{
      measuring: Known<{ lapsDone: number; lapsNeeded: number }>;
      estimateMsPerLap: Known<Ms>;
    }>();
  });
});
