// The stream hash's job filter on a synthetic stream (review 7 R7-2, supervisor ruling 2026-10-31). In a real replay no
// job result arrives before the end (`job-stream-hash.test.ts`), so the filter is pinned here: `StreamHash` hashes the
// messages one client receives, each with the topic of its subscription, and leaves out every message of a job topic.
// `topicStreamHash` hashes its replay through it.
import { describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { StreamHash } from '../../src/pipeline/stream-hash.ts';

const JOB: TopicName = 'session.info';
const PLAIN: TopicName = 'laps';
const OTHER: TopicName = 'cars.overview';

type Received = readonly [TopicName, ServerMessage];

/** The hash of `stream`, with `JOB` the one job topic. */
const hashOf = (stream: readonly Received[]): string => {
  const hash = new StreamHash(new Set([JOB]));
  for (const [topic, message] of stream) hash.add(topic, message);
  return hash.digest();
};

/** A stream of two plain topics: their first status, snapshots and an update. */
const plain: readonly Received[] = [
  [PLAIN, { type: 'topicStatus', id: PLAIN, status: 'noData' }],
  [OTHER, { type: 'snapshot', id: `${OTHER}:0`, value: { cars: [] } }],
  [PLAIN, { type: 'topicStatus', id: PLAIN, status: 'ok' }],
  [PLAIN, { type: 'snapshot', id: PLAIN, entries: [{ lap: 1 }] }],
  [OTHER, { type: 'update', id: `${OTHER}:0`, value: { cars: [1] } }],
];

/** `plain` with the job topic's messages in between, as a worker delivers them: at any point of the stream. */
const withJob: readonly Received[] = [
  [JOB, { type: 'topicStatus', id: JOB, status: 'noData' }],
  plain[0]!,
  plain[1]!,
  [JOB, { type: 'topicStatus', id: JOB, status: 'ok' }],
  [JOB, { type: 'snapshot', id: JOB, value: 1.25 }],
  plain[2]!,
  plain[3]!,
  [JOB, { type: 'update', id: JOB, value: 2.5 }],
  plain[4]!,
];

describe('StreamHash and job topics', () => {
  it('a job topic\'s messages stay out of the hash: a stream with them hashes as the same stream without them', () => {
    expect(hashOf(plain)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf(withJob)).toBe(hashOf(plain));
  });

  it('a job topic\'s messages stay out wherever they arrive and whatever they carry', () => {
    const later: Received[] = [...plain, [JOB, { type: 'update', id: JOB, value: 7 }], [JOB, { type: 'topicStatus', id: JOB, status: 'errored' }]];
    expect(hashOf(later)).toBe(hashOf(withJob));
  });

  it('a changed message of a topic that is no job topic changes the hash', () => {
    const changed = withJob.map(([topic, message]): Received =>
      message.type === 'update' && topic === OTHER ? [topic, { ...message, value: { cars: [2] } }] : [topic, message],
    );
    expect(hashOf(changed)).not.toBe(hashOf(withJob));
  });

  it('every message of a topic that is no job topic counts: one left out changes the hash', () => {
    expect(hashOf(withJob.filter(([, message]) => message.type !== 'update' || message.id === JOB))).not.toBe(hashOf(withJob));
  });
});
