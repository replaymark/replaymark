import { describe, expect, test } from 'vitest';
import { createBus } from '../src/events/bus.ts';
import type { BusEvent } from '../src/shared/events.ts';

describe('bus', () => {
  test('delivers typed events to subscribers until unsubscribed', () => {
    const bus = createBus();
    const got: BusEvent[] = [];
    const off = bus.subscribe((e) => got.push(e));
    bus.publish('live-state', { broadcasterId: '1', live: true });
    off();
    bus.publish('subscriptions', { active: 3 });
    expect(got).toEqual([
      { type: 'live-state', payload: { broadcasterId: '1', live: true } },
    ]);
  });
});
