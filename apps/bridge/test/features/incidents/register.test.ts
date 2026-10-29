import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import { INCIDENTS, INCIDENTS_CONFIG, type IncidentsOutput } from '@pitwall/analysis';
import incidents from '../../../src/features/incidents/register.ts';

const feed: IncidentsOutput = [
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
    where: { sector: known(2, 407_900) },
  },
];

describe('incidents feature', () => {
  it('registers the calculator incidents, declares its config and binds incidents.feed to it', () => {
    expect(incidents.name).toBe('incidents');
    expect(incidents.calculators.map((c) => c.id)).toEqual([INCIDENTS]);
    expect(incidents.config).toContain(INCIDENTS_CONFIG);
    expect(incidents.topics).toHaveLength(1);
    expect(incidents.topics[0]).toMatchObject({ topic: 'incidents.feed', from: INCIDENTS });
  });

  it('the topic value is the calculator output, the feed newest first', () => {
    const binding = incidents.topics[0] as unknown as { select?: (out: IncidentsOutput, params: object) => unknown };
    const select = binding.select ?? ((out: IncidentsOutput) => out);
    expect(select(feed, {})).toEqual(feed);
  });
});
