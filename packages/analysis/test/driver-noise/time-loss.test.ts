// `driver-noise`'s human time-loss events (SP4.3c Task 4, B6; C26, C41, C43): a human's mistakes are the time-loss
// events of `timeLossEvents`, with the one exclusion `timeLossExcludedOf` gives (membership from the projection
// module): a slow mini-sector inside an SC span or inside the car's pit visit is no event, one under green is. The
// cases are `../shared/time-loss-cases.ts`, which `incidents` reads too (one rule). Through the guarded view of what the
// unit declares (C41, `humanModelOf`).
import { describe, expect, it } from 'vitest';
import { humanModelOf, SLOW_LOSS_MS } from '../shared/time-loss-cases.ts';

describe('driver-noise: human time-loss events (B6)', () => {
  it('under green the slow mini-sector is one mistake of its size', () => {
    const human = humanModelOf('green');
    expect(human.mistakes).toBe(1);
    expect(human.mistakeMedianMs?.value).toBeCloseTo(SLOW_LOSS_MS, 6);
  });

  it('inside an SC span it is none', () => {
    expect(humanModelOf('sc').mistakes).toBe(0);
  });

  it("inside the car's pit visit it is none", () => {
    expect(humanModelOf('pitVisit').mistakes).toBe(0);
  });
});
