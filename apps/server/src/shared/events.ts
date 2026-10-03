// SSE event payloads, shared between server and web. Type-only (erasable).

export interface SyncResult {
  /** Epoch ms when the run finished. */
  at: number;
  ok: boolean;
  active: number;
  created: number;
  deleted: number;
  errors: string[];
}

export type SyncEvent =
  | { phase: 'start'; reason: string }
  | { phase: 'end'; reason: string; result: SyncResult };

export interface LiveStateEvent {
  broadcasterId: string;
  live: boolean;
  streamId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  title?: string | null;
  /** Epoch ms. */
  startedAt?: number | null;
}

export interface SubscriptionsEvent {
  active: number;
}

export interface NotificationEvent {
  streamId: string;
  categoryId: string;
  broadcasterId: string;
  /** Set by the outbox worker once delivery finished. */
  status?: 'sent' | 'failed';
  outboxId?: number;
}

export interface TimelineEvent {
  streamId: string;
}

/** A game group of one account was created, changed or deleted. */
export interface GroupsEvent {
  ownerId: number;
}

export interface EventMap {
  'live-state': LiveStateEvent;
  subscriptions: SubscriptionsEvent;
  notification: NotificationEvent;
  sync: SyncEvent;
  timeline: TimelineEvent;
  groups: GroupsEvent;
}

export type EventType = keyof EventMap;

export type BusEvent = {
  [K in EventType]: { type: K; payload: EventMap[K] };
}[EventType];
