import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';

const capture = () => {
  const lines: string[] = [];
  const destination = new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done(); } });
  return { lines, destination };
};

describe('createLogger', () => {
  it('writes one JSON object per line with the numeric level, the message and the bound fields', () => {
    const { lines, destination } = capture();
    createLogger({ level: 'info', destination }).info({ feedId: 'live' }, 'hello');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 30, feedId: 'live', msg: 'hello' });
  });
  it('drops messages below the level', () => {
    const { lines, destination } = capture();
    const log = createLogger({ level: 'warn', destination });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(['w', 'e']);
  });
  it('silent writes nothing, debug writes debug', () => {
    const quiet = capture();
    createLogger({ level: 'silent', destination: quiet.destination }).error('e');
    expect(quiet.lines).toEqual([]);
    const loud = capture();
    createLogger({ level: 'debug', destination: loud.destination }).debug('d');
    expect(JSON.parse(loud.lines[0]!)).toMatchObject({ level: 20, msg: 'd' });
  });
  it('serialises an Error under err with its message', () => {
    const { lines, destination } = capture();
    createLogger({ level: 'error', destination }).error({ err: new Error('boom') }, 'failed');
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 50, err: { message: 'boom' } });
  });
});
