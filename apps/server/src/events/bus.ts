import { EventEmitter } from 'node:events';
import type { BusEvent, EventMap, EventType } from '../shared/events.ts';

export type BusListener = (event: BusEvent) => void;

export interface Bus {
  publish<K extends EventType>(type: K, payload: EventMap[K]): void;
  /** Receives every event; returns an unsubscribe function. */
  subscribe(listener: BusListener): () => void;
}

const CHANNEL = 'event';

export function createBus(): Bus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    publish(type, payload) {
      emitter.emit(CHANNEL, { type, payload } as BusEvent);
    },
    subscribe(listener) {
      emitter.on(CHANNEL, listener);
      return () => {
        emitter.off(CHANNEL, listener);
      };
    },
  };
}
