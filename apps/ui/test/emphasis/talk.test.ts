import { describe, expect, it } from 'vitest';
import { talkRole } from '../../src/emphasis/talk.ts';

describe('talkRole: the talk window -> role map (top bar)', () => {
  it('clear is grey (colour only where it warns)', () => expect(talkRole('clear')).toBe('textDim'));
  it('busy is warning', () => expect(talkRole('busy')).toBe('warning'));
});
