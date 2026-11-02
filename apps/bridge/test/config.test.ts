import { expect, it } from 'vitest';
import { StartupError } from '../src/startup-error.ts';
import { loadConfig } from '../src/config.ts';

it('reads ports from env with defaults', () => {
  expect(loadConfig({})).toEqual({ wsPort: 4777, udpPort: 20777, udpHost: '0.0.0.0', uiPort: 5173 });
  expect(loadConfig({ PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '30777' })).toMatchObject({ wsPort: 0, udpPort: 30777 });
  expect(() => loadConfig({ PITWALL_WS_PORT: 'abc' })).toThrow('PITWALL_WS_PORT must be an integer 0-65535, got "abc"');
  expect(() => loadConfig({ PITWALL_UDP_PORT: '70000' })).toThrow('PITWALL_UDP_PORT must be an integer 0-65535, got "70000"');
});

it('reads the UI port and accepts the range limits', () => {
  expect(loadConfig({ PITWALL_UI_PORT: '8080' }).uiPort).toBe(8080);
  expect(loadConfig({ PITWALL_WS_PORT: '65535' }).wsPort).toBe(65_535);
});

it('rejects negative, fractional and out-of-range ports with a StartupError naming the variable', () => {
  expect(() => loadConfig({ PITWALL_UI_PORT: '-1' })).toThrow('PITWALL_UI_PORT must be an integer 0-65535, got "-1"');
  expect(() => loadConfig({ PITWALL_WS_PORT: '1.5' })).toThrow('PITWALL_WS_PORT must be an integer 0-65535, got "1.5"');
  expect(() => loadConfig({ PITWALL_WS_PORT: '65536' })).toThrow(StartupError);
});

// PITWALL_UDP_HOST: the address the UDP socket binds (step-back review item 12), e.g. the VPN interface only.
it('binds UDP on every interface by default and on the address PITWALL_UDP_HOST gives', () => {
  expect(loadConfig({}).udpHost).toBe('0.0.0.0');
  expect(loadConfig({ PITWALL_UDP_HOST: '10.66.0.2' }).udpHost).toBe('10.66.0.2');
  expect(loadConfig({ PITWALL_UDP_HOST: '127.0.0.1' }).udpHost).toBe('127.0.0.1');
});

it.each(['abc', '', '10.66.0', '256.1.2.3', '10.66.0.2:20777', '::1'])(
  'rejects PITWALL_UDP_HOST "%s" with a StartupError naming the variable and the value',
  (raw) => {
    expect(() => loadConfig({ PITWALL_UDP_HOST: raw })).toThrow(StartupError);
    expect(() => loadConfig({ PITWALL_UDP_HOST: raw })).toThrow(`PITWALL_UDP_HOST`);
    expect(() => loadConfig({ PITWALL_UDP_HOST: raw })).toThrow(`got "${raw}"`);
  },
);
