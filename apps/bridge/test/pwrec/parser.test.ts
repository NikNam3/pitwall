import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PwrecParser } from '../../src/pwrec/parser.ts';
import { META, concat, pwrecHeader, pwrecRecord } from './helpers.ts';

const p = (...b: number[]) => new Uint8Array(b);
const STREAM = concat(pwrecHeader(), pwrecRecord(0, 0.5, p(1, 2, 3)), pwrecRecord(7, 1, p(9, 9, 9, 9, 9)),
  pwrecRecord(0, 16.25, p(4)), pwrecRecord(0, 16.25, p()), pwrecRecord(255, 5000.5));
const EXPECTED = [{ kind: 0, t: 0.5, payload: p(1, 2, 3) }, { kind: 0, t: 16.25, payload: p(4) }, { kind: 0, t: 16.25, payload: p() }];

describe('PwrecParser', () => {
  it('parses header and datagrams, skips unknown kinds by len, ends on kind 255', () => {
    const parser = new PwrecParser();
    expect(parser.push(STREAM)).toEqual(EXPECTED);
    expect(parser.meta).toEqual(META);
    expect(parser.error).toBeUndefined();
    expect(parser.finish()).toEqual({ endedCleanly: true, durationMs: 5000.5, truncatedBytes: 0 });
  });
  it('gives the same result for any chunking', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: STREAM.length - 1 }), { maxLength: 12 }), (cuts) => {
      const parser = new PwrecParser();
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), STREAM.length];
      const out = bounds.slice(1).flatMap((end, i) => parser.push(STREAM.slice(bounds[i], end)));
      expect(out).toEqual(EXPECTED);
      expect(parser.finish()).toEqual({ endedCleanly: true, durationMs: 5000.5, truncatedBytes: 0 });
    }));
  });
  it('keeps returned payloads intact after later pushes', () => {
    const parser = new PwrecParser();
    const first = parser.push(STREAM.slice(0, 120));
    parser.push(STREAM.slice(120));
    expect(first[0]?.payload).toEqual(p(1, 2, 3));
  });
  it('ignores bytes after the end record', () => {
    const parser = new PwrecParser();
    expect(parser.push(concat(STREAM, pwrecRecord(0, 6000, p(8))))).toEqual(EXPECTED);
  });
  it('treats an incomplete last record as the end and keeps earlier records', () => {
    const parser = new PwrecParser();
    const cut = pwrecRecord(0, 2, p(4, 5, 6));
    expect(parser.push(concat(pwrecHeader(), pwrecRecord(0, 1, p(1, 2, 3)), cut.subarray(0, 5)))).toEqual([{ kind: 0, t: 1, payload: p(1, 2, 3) }]);
    expect(parser.finish()).toEqual({ endedCleanly: false, truncatedBytes: 5 });
    const mid = new PwrecParser();
    mid.push(concat(pwrecHeader(), pwrecRecord(0, 2, new Uint8Array(20)).subarray(0, 24)));
    expect(mid.finish()).toEqual({ endedCleanly: false, truncatedBytes: 24 });
  });
  it('rejects a bad magic', () => {
    const parser = new PwrecParser();
    expect(parser.push(concat(pwrecHeader(META, { magic: 'PWREX' }), pwrecRecord(0, 1, p(1))))).toEqual([]);
    expect(parser.error).toEqual({ kind: 'badMagic' });
    expect(parser.push(pwrecRecord(0, 2, p(1)))).toEqual([]);
  });
  it('rejects version 2', () => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader(META, { version: 2 }));
    expect(parser.error).toEqual({ kind: 'badVersion', version: 2 });
  });
  it.each([['invalid JSON', { json: '{"recorderVersion":' }], ['missing listenPort', { json: '{"recorderVersion":"0.1.0","startedAt":"x"}' }],
    ['not an object', { json: '[1,2]' }]])('badMeta: %s', (_n, o) => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader(META, o));
    expect(parser.error).toEqual({ kind: 'badMeta' });
  });
  it('an incomplete header is badMeta at finish', () => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader().subarray(0, 7));
    expect(parser.finish()).toEqual({ endedCleanly: false, truncatedBytes: 7 });
    expect(parser.error).toEqual({ kind: 'badMeta' });
  });
  it('keeps unknown metadata fields', () => {
    const meta = { ...META, host: 'driver-pc', extra: { a: [1, 2] } };
    const parser = new PwrecParser();
    parser.push(pwrecHeader(meta));
    expect(parser.meta).toEqual(meta);
  });
});
