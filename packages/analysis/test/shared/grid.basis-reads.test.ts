// `shared/grid.ts`'s users declare `decisions` (SP4.3e Task 7a-2, round 2; C41, C62, spec §4.2): `gridOf` reads
// `view.basis` (a Q3's earlier segments), and `view.basis` follows the projection's newest `basisChosen` decision, so a
// unit that reaches `gridOf` declares `decisions` in its `reads` (C62). Its one user is `planningInputFrom`, the input
// of the planning job (C62d), which runs it on the ended qualifying's as-of view.
import { describe, expect, it } from 'vitest';
import { PLANNING_JOB } from '../../src/strategy/index.ts';

describe('gridOf\'s users declare decisions (C62)', () => {
  it('the planning job, whose input gridOf builds (planningInputFrom), declares decisions in its reads', () => {
    expect(PLANNING_JOB.reads).toContain('decisions');
  });
});
