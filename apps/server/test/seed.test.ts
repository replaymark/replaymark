import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { follows, mailOutbox, streamers, streams } from '../src/db/schema.ts';
import { SeedRefusedError, seedDemoData } from '../src/seed.ts';
import { createTestDb } from './helpers/db.ts';
import { seedStreamer } from './helpers/seed.ts';

const NOW = Date.UTC(2025, 5, 15, 12);

describe('seedDemoData', () => {
  const handles: ReturnType<typeof createTestDb>[] = [];
  const open = () => {
    const h = createTestDb();
    handles.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of handles.splice(0)) h.close();
  });

  it('fills an empty database with streamers, follows and history', () => {
    const { db } = open();
    const r = seedDemoData(db, { now: NOW });
    expect(r.streamers).toBe(10);
    expect(db.select().from(streamers).all()).toHaveLength(10);
    const modes = new Set(
      db
        .select()
        .from(follows)
        .all()
        .map((f) => f.gameMode),
    );
    expect(modes).toEqual(new Set(['default', 'custom', 'any']));
    expect(r.streams).toBeGreaterThan(20);
    expect(db.select().from(streams).all()).toHaveLength(r.streams);
    expect(r.notifications).toBeGreaterThan(0);
    expect(
      db.select().from(mailOutbox).where(eq(mailOutbox.status, 'sent')).all(),
    ).toHaveLength(r.notifications);
  });

  it('is deterministic for a fixed time', () => {
    const a = open();
    const b = open();
    expect(seedDemoData(a.db, { now: NOW })).toEqual(
      seedDemoData(b.db, { now: NOW }),
    );
    expect(a.db.select().from(streams).all()).toEqual(
      b.db.select().from(streams).all(),
    );
  });

  it('refuses a second run without force and accepts it with force', () => {
    const { db } = open();
    seedDemoData(db, { now: NOW });
    expect(() => seedDemoData(db, { now: NOW })).toThrow(SeedRefusedError);
    expect(() => seedDemoData(db, { now: NOW, force: true })).not.toThrow();
    expect(db.select().from(streamers).all()).toHaveLength(10);
  });

  it('refuses a database with an existing streamer', () => {
    const { db } = open();
    seedStreamer(db, { id: '1' });
    expect(() => seedDemoData(db, { now: NOW })).toThrow(SeedRefusedError);
  });
});
