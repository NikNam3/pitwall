// The game's forecast for this session with the first rain sample, for the forecast strip (spec 3.3).
import type { WeatherForecast } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, WeatherForecast>({ owner: 'weather', mode: 'state', maxHz: 1 });
