// SP4.3e Task 0b (C39, C62, C76): `view.basis` is the session-start basis until the projection holds a `basisChosen`
// decision, then the context the bridge registered for the newest one's basis; a later decision naming the start basis
// gives it again. A decision whose basis the bridge has not loaded gives the named basis with no sessions.
import { describe, expect, it } from 'vitest';
import { NO_BASIS } from '@pitwall/domain';
import { timeline } from '../support/runner.ts';
import { A, B, BASIS_A, BASIS_B, basisRunner, choose, player, runNoting } from '../support/basis.ts';

describe('SessionRunner: view.basis from the session-start basis and basisChosen decisions (C62, C76)', () => {
  it('is the start basis before the decision, the registered one from its frame on, and the start basis again after a second one', () => {
    const frames = timeline(30, []);
    const runner = basisRunner(frames);
    const seen = runNoting(runner, frames, (i) => (i === 10 ? [choose(BASIS_B)] : i === 20 ? [choose(BASIS_A)] : undefined));
    for (let i = 0; i < 10; i++) expect(seen.get(i)).toEqual(A);
    for (let i = 10; i < 20; i++) expect(seen.get(i)).toEqual(B);
    for (let i = 20; i < 30; i++) expect(seen.get(i)).toEqual(A);
    expect(runner.state.history.decisions.map((d) => d.kind)).toEqual(['basisChosen', 'basisChosen']);
  });

  it('is the session-start basis without a decision', () => {
    const frames = timeline(5, []);
    const runner = basisRunner(frames);
    runNoting(runner, frames);
    expect(runner.state.basis).toEqual(A);
  });

  it('gives the named basis with no sessions when the bridge has not loaded it', () => {
    const frames = timeline(15, []);
    const runner = basisRunner(frames, () => undefined);
    const seen = runNoting(runner, frames, (i) => (i === 10 ? [choose(BASIS_B)] : undefined));
    expect(seen.get(9)).toEqual(A);
    expect(seen.get(10)).toEqual({ basis: BASIS_B, player, sessions: [] });
  });

  it('a choice of no basis gives no sessions', () => {
    const frames = timeline(15, []);
    const runner = basisRunner(frames);
    runNoting(runner, frames, (i) => (i === 10 ? [choose(NO_BASIS)] : undefined));
    expect(runner.state.basis).toEqual({ basis: NO_BASIS, player, sessions: [] });
  });
});
