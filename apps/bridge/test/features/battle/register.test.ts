import { BATTLE, BATTLE_CONFIG } from '@pitwall/analysis';
import { carId, unknown, type BattleCard } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { TopicBinding } from '../../../src/features/feature.ts';
import battle from '../../../src/features/battle/register.ts';

const card = (n: number): BattleCard => ({
  carId: carId(n),
  ahead: unknown('notApplicable'),
  behind: unknown('notApplicable'),
});

describe('battle feature', () => {
  it('registers the battle calculator, its config and the topic battle.cards', () => {
    expect(battle.name).toBe('battle');
    expect(battle.calculators.map((c) => c.id)).toEqual([BATTLE]);
    expect(battle.config).toEqual([BATTLE_CONFIG]);
    expect(battle.topics.map((t) => t.topic)).toEqual(['battle.cards']);
  });

  it('select returns the card for params.carId and undefined for an unknown car', () => {
    const binding = battle.topics[0] as Extract<TopicBinding, { from: string }>;
    expect(binding.from).toBe(BATTLE);
    const out = { 0: card(0), 1: card(1) };
    expect(binding.select?.(out, { carId: 1 })).toEqual(card(1));
    expect(binding.select?.(out, { carId: 7 })).toBeUndefined();
    expect(binding.select?.(out, {})).toBeUndefined();
  });
});
