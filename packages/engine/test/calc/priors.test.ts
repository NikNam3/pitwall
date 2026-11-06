// `priorsOf` (contract C62a; spec 3.3, 3.4): `view.priors` is the snapshot of the newest `calibrationChosen` in the
// projection's decisions, else the session-start snapshot; `notApplicable` without one (no set, `defaults` chosen, a
// recording without a priors sidecar). The time a known snapshot carries is not asserted here.
import { describe, expect, it } from 'vitest';
import type { DecisionRecord, FrameNumber } from '@pitwall/domain';
import { priorsOf } from '../../src/calc/priors.ts';
import { DEFAULTS, PICK_A, PICK_B, priorsValue, runPriors, SNAP_A, SNAP_B, type GivenDecision } from '../support/decisions.ts';

/** The decisions in the projection, in order, each on the next frame. */
const facts = (...given: GivenDecision[]): DecisionRecord[] => given.map((d, i) => ({ ...d, frame: (100 + i) as FrameNumber }));

describe('priorsOf (C62a)', () => {
  it.each([
    ['no decision: the start snapshot', [], 'A', SNAP_A],
    ['no decision and no start snapshot: notApplicable', [], null, 'notApplicable'],
    ['a pick: its snapshot', [PICK_B], 'A', SNAP_B],
    ['a pick without a start snapshot: its snapshot', [PICK_B], null, SNAP_B],
    ['the newest decision wins', [PICK_B, PICK_A], null, SNAP_A],
    ['the newest decision wins over the start snapshot', [PICK_A, PICK_B], 'A', SNAP_B],
    ['defaults chosen (setId null): notApplicable', [DEFAULTS], 'A', 'notApplicable'],
    ['defaults chosen after a pick: notApplicable', [PICK_B, DEFAULTS], 'A', 'notApplicable'],
    ['a pick after defaults: its snapshot', [DEFAULTS, PICK_B], 'A', SNAP_B],
  ] as const)('priorsOf: none is the start snapshot; the newest decision wins; setId null or no start is notApplicable: %s', (_, decisions, start, expected) => {
    expect(priorsValue(priorsOf(facts(...decisions), runPriors(start)))).toEqual(expected);
  });
});
