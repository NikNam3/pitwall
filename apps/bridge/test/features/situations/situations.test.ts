// The situation topics (C20, C53–C55, C57, C33, C49): one core topic per sub-machine, `situation.<camelMachineId>`,
// bound with `bindSituation(topic, machine)` in the one feature `situations`. Its value is the machine's spans as they
// are (`MachineSpans`): the open ones (`view.situation.byMachine[machine]`) and the closed ones (the projection's
// `spans[machine]`), each with its frames (C26), and no signal (C13, C54). A state topic, recomputed after a flashback,
// so a client then holds what a run that never received the undone frames gives it (C33). Published only while
// subscribed; a new subscriber gets the current spans at once (ruling 3, C49).
//
// What the spans are is the engine's, read here by a probe unit with an `insights` hook (so it always runs) that reads
// every `spans:<machine>` tag and keeps a copy of each machine's spans whenever any of them changed.
import { describe, expect, it } from 'vitest';
import { TOPICS, type MachineSpans, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { SPAN_DECLARATIONS, type FeedId, type MachineId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../../packages/engine/test/builders/index.ts';
import { defineFeature, type Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { TopicHub } from '../../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../../src/input/packet-source.ts';
import { PwrecSource } from '../../../src/input/pwrec-source.ts';
import { createLogger } from '../../../src/log.ts';
import { FeedPipeline } from '../../../src/pipeline/feed-pipeline.ts';
import { segmentPath } from '../../fixtures/replay.ts';
import { ArraySource, type PreparedPacket } from '../../helpers/array-source.ts';
import { ManualSource } from '../../helpers/manual-source.ts';

const F = 'situations' as FeedId;
const silent = createLogger({ level: 'silent' });

const MACHINES: readonly MachineId[] = SPAN_DECLARATIONS.map((d) => d.machine);
/** The topic of a machine's spans: `situation.` and the machine id in camelCase (C53, C56: a core topic, no owner prefix). */
const topicOf = (machine: MachineId): TopicName => `situation.${machine.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as TopicName;
const SITUATION_TOPICS = MACHINES.map(topicOf);

/**
 * Every signal of C12, by its game name and by the name the engine's signals module gives it: none may appear as a key
 * anywhere in a situation topic's value (C13, C54).
 */
const SIGNAL_FIELDS = new Set([
  'pitStatus', 'driverStatus', 'pitLaneTimerActive', 'resultStatus', 'numPitStops', 'pitStopShouldServePen',
  'numUnservedDriveThroughPens', 'numUnservedStopGoPens', 'penalties', 'totalWarnings', 'cornerCuttingWarnings',
  'currentLapInvalid', 'vehicleFIAFlags', 'vehicleFiaFlags', 'drsAllowed', 'networkPaused', 'safetyCarStatus', 'marshalZones',
  'numSafetyCarPeriods', 'numVirtualSafetyCarPeriods', 'numRedFlagPeriods', 'sessionType', 'weekendStructure',
  'numSessionsInWeekend', 'ruleSet', 'gamePaused', 'isSpectating', 'spectatorCarIndex', 'numActiveCars', 'aiControlled',
  'shouldServePenalty', 'unservedDriveThroughs', 'unservedStopGos', 'timePenaltyMs', 'fiaFlag', 'periods', 'signals',
]);

/** Every key of `value`, at any depth. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

/** The situations feature, as the generated feature index collects it (C63). */
const situationsFeature = (): Feature => {
  const feature = FEATURES.find((f) => f.name === 'situations');
  if (feature === undefined) throw new Error('no feature "situations" in the generated feature index');
  return feature;
};

/** Each machine's spans whenever any changed: what the engine's view holds then, copied (the projection grows in place). */
function spansProbe() {
  const seen: Array<Record<MachineId, MachineSpans>> = [];
  const probe: QuickCalculator<number> = {
    kind: 'quick',
    id: 'probe.spans',
    reads: MACHINES.map((machine) => `spans:${machine}`) as never,
    cadence: 'frame',
    compute: ({ situation, history }) => {
      seen.push(Object.fromEntries(MACHINES.map((machine) => [machine, structuredClone({
        open: [...(situation.byMachine[machine] ?? [])],
        closed: [...(history.spans[machine] ?? [])],
      }) as MachineSpans])));
      return seen.length;
    },
    insights: () => [],
  };
  return { feature: defineFeature({ name: 'probe-spans', calculators: [probe], topics: [] }), seen };
}

/** One hub, one client; `inbox` keeps each message as sent and a deep copy taken when it was sent. */
function client(now: () => number, onDemandChange?: () => void) {
  const hub = new TopicHub({ now, ...(onDemandChange && { onDemandChange }) });
  const inbox: Array<{ message: ServerMessage; asSent: ServerMessage }> = [];
  hub.addClient('c', { send: (message) => inbox.push({ message, asSent: structuredClone(message) }), bufferedAmount: () => 0 });
  const subscribe = (topic: TopicName) => hub.subscribe({ clientId: 'c', id: topic, topic, params: {}, feedId: F });
  /** The values received on subscription `id` (the topic's name), from snapshots and updates, in order. */
  const values = (id: string): MachineSpans[] =>
    inbox.flatMap(({ message: m }) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value as MachineSpans] : []));
  return { hub, inbox, subscribe, values };
}

/** Runs `source` through a pipeline with the situations feature and the probe, every situation topic subscribed. */
async function run(source: PacketSource) {
  let now = 0;
  const c = client(() => (now += 1000)); // every publish is due: nothing is throttled away
  for (const topic of SITUATION_TOPICS) c.subscribe(topic);
  const probe = spansProbe();
  const pipeline = new FeedPipeline({ feedId: F, source, hub: c.hub, features: [situationsFeature(), probe.feature], log: silent });
  pipeline.start();
  await pipeline.done;
  return { ...c, seen: probe.seen };
}

type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed): PreparedPacket[] => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** `vehicleFiaFlags` 3: yellow (0: none). */
const YELLOW = 3;
/** Two cars; car 0 is shown yellow on the frames in `[yellow.from, yellow.to)`, so car-flags opens and closes spans there. */
const scenario = (frames: number, yellow?: { from: number; to: number }) =>
  new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(frames, (d, i) => {
    d.status.carStatusData[0]!.vehicleFiaFlags = yellow !== undefined && i >= yellow.from && i < yellow.to ? YELLOW : 0;
  });

/**
 * Frames 0..59 with car 0 yellow on 40..49, then the game rewinds to frame 30 and plays 31..79 without a yellow
 * (`overallFrameIdentifier` keeps rising). The yellow spans were recorded only by undone frames.
 */
const withFlashback = (): PreparedPacket[] => {
  const continuation = scenario(80).packets().filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
  const rewound = continuation.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
    receivedAtMs: receivedAtMs + 29 * 16,
  }));
  return [...toPrepared(scenario(60, { from: 40, to: 50 }).packets()), ...toPrepared(rewound)];
};

/** The race segment's run, shared by the rows that read it. */
let segment: ReturnType<typeof run> | undefined;
const segmentRun = () => (segment ??= run(new PwrecSource({ feedId: F, path: segmentPath('race-drive-through-served.pwrec.gz'), mode: 'asFastAsPossible' })));

const hasYellow = (value: MachineSpans | undefined): boolean =>
  value !== undefined && [...value.open, ...value.closed].some((span) => span.kind === 'yellow');

describe('the situations feature (C53, C55, C63)', () => {
  it('binds one topic per sub-machine, situation.<camelMachineId>, each with bindSituation(topic, machine), and runs no calculator', () => {
    const feature = situationsFeature();
    expect(feature.calculators).toEqual([]);
    const byTopic = (a: { topic: string }, b: { topic: string }) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0);
    expect([...feature.topics].sort(byTopic)).toEqual(MACHINES.map((machine) => ({ topic: topicOf(machine), fromSituation: machine })).sort(byTopic));
  });

  it('every situation topic of the contracts package is one of these, and each is a core state topic of the feed', () => {
    const declared = Object.keys(TOPICS).filter((name) => name.startsWith('situation.')).sort();
    expect(declared).toEqual([...SITUATION_TOPICS].sort());
    for (const topic of SITUATION_TOPICS) expect(TOPICS[topic], topic).toMatchObject({ owner: 'core', scope: 'feed', mode: 'state' });
  });
});

describe('each situation topic carries the open and closed spans of its machine and no signal field (C20, C54, C13)', () => {
  it('on a race segment (a drive-through served): the last value of every topic is its machine\'s spans as the engine holds them', async () => {
    const r = await segmentRun();
    const expected = r.seen.at(-1)!;
    expect(expected).toBeDefined();
    const withSpans = MACHINES.filter((machine) => expected[machine]!.open.length + expected[machine]!.closed.length > 0);
    // the segment is a race: the shared and race sub-machines have spans
    expect(withSpans).toEqual(expect.arrayContaining(['clock', 'car-location', 'car-status', 'car-flags', 'car-activity-race', 'penalties', 'session-phase-race']));
    for (const machine of MACHINES) {
      const topic = topicOf(machine);
      const last = r.values(topic).at(-1);
      if (withSpans.includes(machine)) expect(last, topic).toEqual(expected[machine]);
      // a machine that does not run in this phase has no spans: its topic carries none, or nothing at all
      else expect(last ?? { open: [], closed: [] }, topic).toEqual({ open: [], closed: [] });
    }
  });

  it('every value is a MachineSpans of its own machine, never changes after it was sent, and has no signal field anywhere', async () => {
    const r = await segmentRun();
    let sent = 0;
    for (const machine of MACHINES) {
      for (const value of r.values(topicOf(machine))) {
        sent++;
        expect(Object.keys(value).sort(), topicOf(machine)).toEqual(['closed', 'open']);
        for (const span of [...value.open, ...value.closed]) expect(span.machine, topicOf(machine)).toBe(machine);
        for (const span of value.open) expect(span, topicOf(machine)).not.toHaveProperty('endFrame');
        for (const span of value.closed) expect(span, topicOf(machine)).toHaveProperty('endFrame');
        expect([...keysOf(value)].filter((key) => SIGNAL_FIELDS.has(key)), topicOf(machine)).toEqual([]);
      }
    }
    expect(sent).toBeGreaterThan(0);
    for (const { message, asSent } of r.inbox) expect(message).toEqual(asSent);
  });
});

describe('bindSituation publishes (C55; the rows moved over from Task 18)', () => {
  it('publishes a machine\'s open and closed spans: car 0\'s yellow opens and closes car-flags spans, and the topic follows them', async () => {
    const r = await run(new ArraySource(F, toPrepared(scenario(30, { from: 10, to: 20 }).packets())));
    const values = r.values(topicOf('car-flags'));
    expect(values.some((value) => value.open.some((span) => span.carId === 0 && span.kind === 'yellow'))).toBe(true);
    const last = values.at(-1)!;
    expect(last).toEqual(r.seen.at(-1)!['car-flags']);
    // car 0's yellow is closed by then, and every car slot has one open span (car-flags covers every slot)
    expect(last.closed.filter((span) => span.carId === 0).map((span) => span.kind)).toContain('yellow');
    const openCars = last.open.map((span) => span.carId);
    expect(new Set(openCars).size).toBe(openCars.length);
    expect(openCars).toEqual(expect.arrayContaining([0, 1]));
    expect(last.open.find((span) => span.carId === 0)?.kind).not.toBe('yellow');
  });

  it('after a flashback every situation topic equals a run that never received the undone frames (C33): the undone yellow is gone', async () => {
    const rewound = await run(new ArraySource(F, withFlashback()));
    const straight = await run(new ArraySource(F, toPrepared(scenario(80).packets())));
    // the engine agrees on both runs (C33), and the undone frames' yellow reached the topic before the flashback
    expect(rewound.seen.at(-1)).toEqual(straight.seen.at(-1));
    expect(rewound.values(topicOf('car-flags')).some(hasYellow)).toBe(true);
    for (const topic of SITUATION_TOPICS) expect(rewound.values(topic).at(-1), topic).toEqual(straight.values(topic).at(-1));
    expect(hasYellow(rewound.values(topicOf('car-flags')).at(-1))).toBe(false);
  });
});

describe('published only while subscribed (ruling 3, C49)', () => {
  it('a topic subscribed in the middle of a session gets its machine\'s current spans at once', async () => {
    let now = 0;
    const box: { pipeline?: FeedPipeline } = {};
    const c = client(() => (now += 1000), () => box.pipeline?.demandChanged());
    const probe = spansProbe();
    const source = new ManualSource(F);
    box.pipeline = new FeedPipeline({ feedId: F, source, hub: c.hub, features: [situationsFeature(), probe.feature], log: silent });
    box.pipeline.start();
    const packets = toPrepared(scenario(30, { from: 10, to: 40 }).packets());
    for (const p of packets.slice(0, Math.floor(packets.length / 2))) source.push(p.bytes, p.receivedAtMs);
    const topic = topicOf('car-flags');
    c.subscribe(topic);
    expect(c.inbox.map(({ message }) => message).filter((m) => 'id' in m && m.id === topic)).toEqual([
      { type: 'snapshot', id: topic, value: probe.seen.at(-1)!['car-flags'] },
    ]);
    expect(hasYellow(c.values(topic)[0])).toBe(true);
    await box.pipeline.stop();
  });
});
