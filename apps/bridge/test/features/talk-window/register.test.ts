import { TALK_WINDOW, TALK_WINDOW_CONFIG, type TalkWindowOutput } from '@pitwall/analysis';
import { carId, type TalkWindow } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import talkWindow from '../../../src/features/talk-window/register.ts';

const value = (talk: 'clear' | 'busy'): TalkWindow => ({ talk: { known: true, value: talk, at: 0 } });

describe('talk-window feature', () => {
  it('registers the calculator, its config and the topic talkWindow.car', () => {
    expect(talkWindow.name).toBe('talk-window');
    expect(talkWindow.calculators.map((c) => c.id)).toEqual([TALK_WINDOW]);
    expect(talkWindow.config).toEqual([TALK_WINDOW_CONFIG]);
    expect(talkWindow.topics).toHaveLength(1);
    expect(talkWindow.topics[0]).toMatchObject({ topic: 'talkWindow.car', from: TALK_WINDOW });
  });

  it('publishes per our car: select returns the value for params.carId and undefined for any other car', () => {
    const out: TalkWindowOutput = { [carId(0)]: value('busy'), [carId(1)]: value('clear') };
    const binding = talkWindow.topics[0] as unknown as { select: (out: unknown, params: object) => unknown };
    expect(binding.select(out, { carId: 0 })).toEqual(value('busy'));
    expect(binding.select(out, { carId: 1 })).toEqual(value('clear'));
    expect(binding.select(out, { carId: 7 })).toBeUndefined();
    expect(binding.select(out, {})).toBeUndefined();
  });
});
