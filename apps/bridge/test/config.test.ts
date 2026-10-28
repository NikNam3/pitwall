import { expect, it } from 'vitest';
import { StartupError } from '../src/startup-error.ts';
import { loadConfig } from '../src/config.ts';

it('reads ports from env with defaults', () => {
  expect(loadConfig({})).toEqual({ wsPort: 4777, udpPort: 20777, uiPort: 5173 });
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
