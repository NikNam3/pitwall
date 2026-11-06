// The car option's unset variant (SP4.1b Task 9a): `carOption(label, { unset })` where `unset` is 'follow' (the default:
// unset follows the panel's link) or 'none' (unset is no car, the rival pickers). The kit text of the none choice is `noCar`.
import { describe, expect, it } from 'vitest';
import { carOption } from '../../src/kit/options.ts';
import * as text from '../../src/kit/text.ts';

describe('carOption unset variant', () => {
  it("carOption('Rival 1', { unset: 'none' }) has unset 'none'", () => {
    expect(carOption('Rival 1', { unset: 'none' })).toEqual({ kind: 'car', label: 'Rival 1', default: undefined, unset: 'none' });
  });

  it("carOption('X') has unset 'follow'", () => {
    expect(carOption('X')).toEqual({ kind: 'car', label: 'X', default: undefined, unset: 'follow' });
  });

  it("the none choice's text is noCar = 'none', beside followLink = 'follow'", () => {
    expect(text.noCar).toBe('none');
    expect(text.followLink).toBe('follow');
  });
});
