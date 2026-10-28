import { encodeMessage, TOPICS, type TopicName } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { StartupError } from '../../startup-error.ts';
import { WsClient } from '../../ws/client.ts';
import { whenAborted, type CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';

/** The topics that are subscribed to for one car (their `params` are `{ carId }`). */
const PER_CAR_TOPICS: readonly TopicName[] = ['car.detail', 'car.telemetry'];

type TapValues = { carId?: string | undefined; url?: string | undefined; feed?: string | undefined };

function isTopic(name: string): name is TopicName {
  return Object.hasOwn(TOPICS, name);
}

function carIdOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text)) throw new StartupError(`--carId must be a whole number, got "${text}"`);
  return Number(text);
}

/** `pitwall tap <topic> [--carId n] [--url u] [--feed id]`: prints `hello` and the topic's messages as JSON lines. */
export async function run(positionals: string[], values: TapValues, io: CliIo): Promise<number> {
  const [topic] = positionals;
  if (topic === undefined) throw new UsageError('tap needs a topic');
  if (!isTopic(topic)) throw new StartupError(`unknown topic "${topic}"; topics: ${Object.keys(TOPICS).join(', ')}`);
  const carId = carIdOf(values.carId);
  if (PER_CAR_TOPICS.includes(topic) && carId === undefined) throw new StartupError(`topic ${topic} needs --carId`);

  const url = values.url ?? `ws://127.0.0.1:${loadConfig(io.env).wsPort}`;
  const client = WsClient.connect(url);
  client.onHello((hello) => io.out(encodeMessage(hello)));
  client.subscribe(topic, carId === undefined ? {} : { carId }, (message) => io.out(encodeMessage(message)), values.feed === undefined ? undefined : feedId(values.feed));
  await whenAborted(io.signal);
  client.close();
  return 0;
}
