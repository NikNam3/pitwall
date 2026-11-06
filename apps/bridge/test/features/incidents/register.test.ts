import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import { INCIDENTS, INCIDENTS_CONFIG, type IncidentsOutput } from '@pitwall/analysis';
import type { TopicBinding } from '../../../src/features/feature.ts';
import incidents from '../../../src/features/incidents/register.ts';

const out: IncidentsOutput = {
  feed: [
    {
      id: 'collision:6-5:407900',
      at: 407_900,
      lap: 5,
      kind: 'collision',
      severity: 'major',
      carIds: [carId(6), carId(5)],
      timeLostMs: known(1_800, 409_200),
      forUs: [
        {
          ourCarId: carId(6), otherCarId: known(carId(5), 407_900), positionBefore: known(7, 407_900), positionAfter: unknown('notReceived'),
          gapBeforeMs: known(700, 407_900), gapAfterMs: unknown('notReceived'),
        },
      ],
      where: { sector: known(2, 407_900), turn: known('3', 407_900), fraction: known(0.4, 407_900) },
    },
  ],
  markers: known([{ point: { x: 0.25, y: 0.75 }, kind: 'collision' }], 407_900),
};

/** The value the binding of `topic` publishes for the output (`select`, else the output itself). */
const select = (topic: string): unknown => {
  const b = incidents.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }> | undefined;
  if (b === undefined) throw new Error(`no binding for ${topic}`);
  return b.select ? b.select(out, {}) : out;
};

describe('incidents feature', () => {
  it('registers the calculator incidents, declares its config and binds incidents.feed and incidents.markers to it', () => {
    expect(incidents.name).toBe('incidents');
    expect(incidents.calculators.map((c) => c.id)).toEqual([INCIDENTS]);
    expect(incidents.config).toContain(INCIDENTS_CONFIG);
    expect(incidents.topics.map((t) => t.topic).sort()).toEqual(['incidents.feed', 'incidents.markers']);
    for (const t of incidents.topics) expect(t).toMatchObject({ from: INCIDENTS });
  });

  it('the incidents.feed value is the output feed, newest first', () => {
    expect(select('incidents.feed')).toEqual(out.feed);
  });

  it('the incidents.markers value is the output markers', () => {
    expect(select('incidents.markers')).toEqual(out.markers);
  });
});
