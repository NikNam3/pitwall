// Every presentation table is complete (contract C66, C87): one generic test over every widget whose `widget.ts` declares
// a `situation.<machine>` topic or `raceMoment.current`. Its `presentation.ts` exports `presentation`, a
// `PresentationTable` (`src/kit/presentation.ts`) with a row for every kind (from the domain's span declarations,
// `SPAN_DECLARATIONS`) of every sub-machine whose topic it declares, and a row for every `Moment` when it declares
// `raceMoment.current`; and no row for a machine or `Moment` it does not read, or a kind its machine does not declare.
// A situation topic is named after its machine (C56): `situation.` and the machine id in camelCase.
// An analysis topic whose value carries a sub-machine's kinds (`CARRIES_KINDS`) counts as reading that machine.
import { SPAN_DECLARATIONS, type MachineId, type Moment, type SpanDeclaration } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { AnyDataDecl } from '../src/kit/types.ts';
import type { PresentationTable } from '../src/kit/presentation.ts';

/** Every `Moment`, so a new one fails to compile here until it is listed. */
const MOMENT_SET: Record<Moment, true> = { neutralised: true, incident: true, weather: true, battle: true, carCare: true };
const MOMENTS = Object.keys(MOMENT_SET) as Moment[];
const RACE_MOMENT = 'raceMoment.current';

/** Analysis topics whose value carries a sub-machine's kinds: a widget that declares one reads that machine. */
const CARRIES_KINDS: Readonly<Record<string, MachineId>> = {
  // MapZone.flag is typed by the zone-flags kinds (spec 6.1)
  'trackPositions.cars': 'zone-flags',
};

const topicOf = (machine: MachineId): string => `situation.${machine.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;

/** What a widget reads that its presentation table covers: the machines of its situation topics, and the moments. */
type Reads = { machines: MachineId[]; moments: boolean };

/** The machines and moments of a widget's data declarations; a situation topic of no declared machine is a problem. */
function readsOf(data: Readonly<Record<string, AnyDataDecl>>, declarations: readonly SpanDeclaration[] = SPAN_DECLARATIONS): Reads & { unknownTopics: string[] } {
  const topics = Object.values(data).map((decl) => String(decl.topic));
  const machines: MachineId[] = [];
  const unknownTopics: string[] = [];
  for (const topic of topics) {
    const carried = Object.hasOwn(CARRIES_KINDS, topic) ? CARRIES_KINDS[topic] : undefined;
    if (carried !== undefined) {
      if (!machines.includes(carried)) machines.push(carried);
      continue;
    }
    if (!topic.startsWith('situation.')) continue;
    const machine = declarations.find((d) => topicOf(d.machine) === topic)?.machine;
    if (machine === undefined) unknownTopics.push(topic);
    else if (!machines.includes(machine)) machines.push(machine);
  }
  return { machines, moments: topics.includes(RACE_MOMENT), unknownTopics };
}

/**
 * What is wrong with `widget`'s table against what it reads and the span declarations: a kind of a machine it reads
 * without a row, a `Moment` without a row, a row of a machine (or of the moments) it does not read, a row of a kind its
 * machine does not declare; a widget that reads a sub-machine or the moments without a table.
 */
function tableProblems(
  widget: string,
  reads: Reads,
  table: PresentationTable | undefined,
  declarations: readonly SpanDeclaration[] = SPAN_DECLARATIONS,
): string[] {
  if (table === undefined) return [`${widget}: reads ${[...reads.machines, ...(reads.moments ? [RACE_MOMENT] : [])].join(', ')} but has no presentation.ts exporting presentation`];
  const kindsOf = (machine: string): readonly string[] | undefined => declarations.find((d) => d.machine === machine)?.kinds;
  const situations = table.situations ?? {};
  const problems: string[] = [];
  for (const machine of reads.machines) {
    const rows = situations[machine] ?? {};
    for (const kind of kindsOf(machine) ?? []) if (!Object.hasOwn(rows, kind)) problems.push(`${widget}: no row for ${machine} ${kind}`);
  }
  for (const [machine, rows] of Object.entries(situations)) {
    if (!reads.machines.includes(machine)) {
      problems.push(`${widget}: a row for ${machine}, which it does not read`);
      continue;
    }
    const kinds = kindsOf(machine) ?? [];
    for (const kind of Object.keys(rows)) if (!kinds.includes(kind)) problems.push(`${widget}: a row for ${machine} ${kind}, which ${machine} does not declare`);
  }
  if (reads.moments) {
    const rows: Readonly<Record<string, unknown>> = table.moments ?? {};
    for (const moment of MOMENTS) if (!Object.hasOwn(rows, moment)) problems.push(`${widget}: no row for moment ${moment}`);
    for (const moment of Object.keys(rows)) if (!(MOMENTS as string[]).includes(moment)) problems.push(`${widget}: a row for moment ${moment}, which is no Moment`);
  } else if (table.moments !== undefined) {
    problems.push(`${widget}: rows for the moments, which it does not read`);
  }
  return problems;
}

const declared = import.meta.glob<{ widget: { name: string; data: Readonly<Record<string, AnyDataDecl>> } }>('../src/widgets/*/widget.ts', { eager: true });
const tables = import.meta.glob<{ presentation?: PresentationTable }>('../src/widgets/*/presentation.ts', { eager: true });
const folderOf = (path: string): string => path.split('/').at(-2) ?? path;
const tableOf = (folder: string): PresentationTable | undefined =>
  Object.entries(tables).find(([path]) => folderOf(path) === folder)?.[1].presentation;

const WIDGETS = Object.entries(declared).map(([path, mod]) => ({ folder: folderOf(path), name: mod.widget.name, ...readsOf(mod.widget.data) }));
const READERS = WIDGETS.filter((w) => w.machines.length > 0 || w.moments);

describe('presentation tables (C66)', () => {
  it('finds the widgets and what they read', () => {
    expect(WIDGETS.map((w) => w.folder)).toEqual(expect.arrayContaining(['timing-tower', 'battle-cards', 'feed-status']));
    expect(WIDGETS.every((w) => w.folder === w.name)).toBe(true);
    expect(READERS.map((w) => w.folder)).toEqual(expect.arrayContaining(['timing-tower', 'battle-cards', 'ers-budget', 'incident-feed', 'feed-status']));
  });

  // Task 25: the tower reads the situations it shows from their topics (no signal field, C13, C54): where a car is,
  // whether it competes, what it does by the weekend phase's rules, what it owes; feed-status reads the weekend phase.
  it('the timing tower reads car location, car status, every car-activity machine, penalties, warnings and the weekend phase', () => {
    const tower = WIDGETS.find((w) => w.folder === 'timing-tower');
    expect([...(tower?.machines ?? [])].sort()).toEqual(
      ['car-activity-practice', 'car-activity-qualifying', 'car-activity-race', 'car-location', 'car-status', 'penalties', 'warnings', 'weekend-phase'],
    );
    expect(tower?.moments).toBe(true);
  });

  it('feed-status reads the weekend phase and no moment', () => {
    const feed = WIDGETS.find((w) => w.folder === 'feed-status');
    expect(feed?.machines).toEqual(['weekend-phase']);
    expect(feed?.moments).toBe(false);
  });

  it('every situation topic a widget declares is the topic of a declared sub-machine', () => {
    expect(WIDGETS.flatMap((w) => w.unknownTopics.map((topic) => `${w.folder}: ${topic}`))).toEqual([]);
  });

  it('a table without a reader is a problem too: every presentation.ts belongs to a widget that reads a sub-machine or the moments', () => {
    const readers = new Set(READERS.map((w) => w.folder));
    expect(Object.keys(tables).map(folderOf).filter((folder) => !readers.has(folder))).toEqual([]);
  });

  for (const w of READERS) {
    it(`${w.folder}'s presentation table covers every kind it reads, and nothing else`, () => {
      expect(tableProblems(w.folder, w, tableOf(w.folder))).toEqual([]);
    });
  }

  it('the check names a missing row, a row of an unread machine, a row of an undeclared kind, the moments and a missing table', () => {
    const declarations: SpanDeclaration[] = [
      { machine: 'car-location', scope: 'car', kinds: ['garage', 'pitLane', 'track'] },
      { machine: 'weekend-phase', scope: 'session', kinds: ['practice', 'qualifying', 'race', 'none'] },
    ];
    const reads = readsOf({ a: { topic: 'situation.carLocation' }, b: { topic: 'raceMoment.current' }, c: { topic: 'situation.nothing' } } as unknown as Record<string, AnyDataDecl>, declarations);
    expect(reads).toEqual({ machines: ['car-location'], moments: true, unknownTopics: ['situation.nothing'] });
    const table: PresentationTable = {
      situations: { 'car-location': { garage: 'GARAGE', track: '', boxStop: 'BOX' }, 'weekend-phase': { none: '' } },
      moments: { neutralised: 'n', incident: 'i', weather: 'w', battle: 'b', carCare: 'c', ...{ extra: 'x' } } as Record<Moment, unknown>,
    };
    expect(tableProblems('probe', reads, table, declarations)).toEqual([
      'probe: no row for car-location pitLane',
      'probe: a row for car-location boxStop, which car-location does not declare',
      'probe: a row for weekend-phase, which it does not read',
      'probe: a row for moment extra, which is no Moment',
    ]);
    expect(tableProblems('probe', { machines: ['car-location'], moments: false }, { moments: { neutralised: 1 } as Record<Moment, unknown> }, declarations)).toEqual([
      'probe: no row for car-location garage',
      'probe: no row for car-location pitLane',
      'probe: no row for car-location track',
      'probe: rows for the moments, which it does not read',
    ]);
    expect(tableProblems('probe', { machines: [], moments: true }, { moments: { neutralised: 1 } as Record<Moment, unknown> }, declarations)).toEqual([
      'probe: no row for moment incident',
      'probe: no row for moment weather',
      'probe: no row for moment battle',
      'probe: no row for moment carCare',
    ]);
    expect(tableProblems('probe', reads, undefined, declarations)).toEqual(['probe: reads car-location, raceMoment.current but has no presentation.ts exporting presentation']);
    expect(tableProblems('probe', { machines: ['car-location'], moments: false }, { situations: { 'car-location': { garage: 1, pitLane: 2, track: 3 } } }, declarations)).toEqual([]);
  });

  it('counts an analysis topic that carries a machine\'s kinds as reading that machine', () => {
    const reads = readsOf({ a: { topic: 'trackPositions.cars' }, b: { topic: 'trackPositions.geometry' } } as unknown as Record<string, AnyDataDecl>);
    expect(reads).toEqual({ machines: ['zone-flags'], moments: false, unknownTopics: [] });
  });

  it('the track map reads the zone flags through trackPositions.cars, and no moment', () => {
    const map = WIDGETS.find((w) => w.folder === 'track-map');
    expect(map?.machines).toEqual(['zone-flags']);
    expect(map?.moments).toBe(false);
  });

  it('names a situation topic after its machine', () => {
    expect(topicOf('car-activity-race')).toBe('situation.carActivityRace');
    expect(topicOf('clock')).toBe('situation.clock');
  });
});
