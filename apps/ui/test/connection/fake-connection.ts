import type { ClientMessage, ServerMessage } from '@pitwall/contracts';
import type { Connection, ConnectionState } from '../../src/connection/connection.ts';

/** A scripted `Connection`: tests push server messages, read what the store sent, and simulate close and reopen. */
export class FakeConnection implements Connection {
  readonly sent: ClientMessage[] = [];
  state: ConnectionState;
  private readonly messageListeners = new Set<(m: ServerMessage) => void>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();

  constructor(initial: ConnectionState = 'open') {
    this.state = initial;
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onState(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Delivers a message from the bridge. */
  push(message: ServerMessage): void {
    for (const cb of [...this.messageListeners]) cb(message);
  }

  setState(state: ConnectionState): void {
    this.state = state;
    for (const cb of [...this.stateListeners]) cb(state);
  }

  close(): void {
    this.setState('closed');
  }

  reopen(): void {
    this.setState('connecting');
    this.setState('open');
  }

  subscribes(): Extract<ClientMessage, { type: 'subscribe' }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: 'subscribe' }> => m.type === 'subscribe');
  }

  unsubscribes(): Extract<ClientMessage, { type: 'unsubscribe' }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: 'unsubscribe' }> => m.type === 'unsubscribe');
  }
}
