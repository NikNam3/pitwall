// The weekend-phase sub-machine (contract C14): the phase and format a session type decides, one span per session. The
// span opens once the phase is decided (types 0, 18 and above 18 at once; the others when the weekend structure
// arrives) and never changes; until then no span is open and the weekend phase is pending.
import { weekendPhaseSpans, type PracticeFormat, type QualifyingFormat, type WeekendPhase } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

type Segment = 1 | 2 | 3 | undefined;
type Decided = { kind: string; detail: object };
type Open = { frames: number; span: { id: number; start: number; startFrame: number; kind: string; detail: object; joinedAt?: true } | undefined };

const PRACTICE: Record<number, [PracticeFormat, Segment]> = { 1: ['practice', 1], 2: ['practice', 2], 3: ['practice', 3], 4: ['shortPractice', undefined] };
const QUALIFYING: Record<number, [QualifyingFormat, Segment]> = {
  5: ['grandPrix', 1], 6: ['grandPrix', 2], 7: ['grandPrix', 3], 8: ['short', undefined], 9: ['oneShot', undefined],
  10: ['sprintShootout', 1], 11: ['sprintShootout', 2], 12: ['sprintShootout', 3], 13: ['shortSprintShootout', undefined], 14: ['oneShotSprintShootout', undefined],
};
const isRace = (type: number): boolean => type >= 15 && type <= 17;

/** The phase a session type decides, given the weekend structure; `undefined` while it needs a structure that is not there. */
const decide = (sessionType: number, structure: readonly number[]): Decided | undefined => {
  if (sessionType <= 0 || sessionType >= 18) return { kind: 'none', detail: {} };
  if (structure.length === 0) return undefined;
  const practice = PRACTICE[sessionType];
  if (practice) return { kind: 'practice', detail: { format: practice[0], segment: practice[1] } };
  const qualifying = QUALIFYING[sessionType];
  if (qualifying) return { kind: 'qualifying', detail: { format: qualifying[0], segment: qualifying[1] } };
  return { kind: 'race', detail: { format: structure.some((t) => isRace(t) && t > sessionType) ? 'sprint' : 'grandPrix' } };
};

const machine: SubMachine<Open> = {
  id: 'weekend-phase',
  appliesTo: 'all',
  spans: weekendPhaseSpans,
  inputs: { signals: ['sessionType', 'weekendStructure'], values: [], upstream: [] },
  transitions: [['none', 'practice'], ['none', 'qualifying'], ['none', 'race'], ['none', 'none']],
  init: () => ({ frames: 0, span: undefined }),
  openSpans: (open) =>
    open.span === undefined
      ? []
      : [{ machine: 'weekend-phase', id: open.span.id, kind: open.span.kind, start: open.span.start, startFrame: open.span.startFrame, confirmed: true, detail: open.span.detail, ...(open.span.joinedAt ? { joinedAt: true as const } : {}) }],
  step(open, input): MachineStep<Open> {
    const frames = open.frames + 1;
    if (open.span !== undefined) return { open: { frames, span: open.span }, closed: [] };
    const decided = decide(input.signals.session.sessionType, input.signals.session.weekendStructure);
    if (decided === undefined) return { open: { frames, span: undefined }, closed: [] };
    const span = { id: 0, start: input.at, startFrame: input.frameNumber, kind: decided.kind, detail: decided.detail, ...(frames === 1 ? { joinedAt: true as const } : {}) };
    return { open: { frames, span }, closed: [] };
  },
};

export default machine;

/** The weekend phase a sub-machine's open span stands for: pending when none is open. */
export const phaseOfSpan = (span: { kind: string; detail: unknown } | undefined): WeekendPhase =>
  span === undefined ? { kind: 'pending' } : ({ kind: span.kind, ...(span.detail as object) } as WeekendPhase);
