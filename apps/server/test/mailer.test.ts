import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { setMailLanguage, setRecipients } from '../src/db/settings.ts';
import {
  createMailer,
  type MailMessage,
  sendTestMail,
} from '../src/mail/mailer.ts';
import { createTestDb } from './helpers/db.ts';

let handle: DbHandle;
let sent: MailMessage[];
const transport = {
  sendMail: async (msg: MailMessage) => {
    sent.push(msg);
  },
};

beforeEach(() => {
  handle = createTestDb();
  sent = [];
});
afterEach(() => handle.close());

test('test mail goes directly to all recipients', async () => {
  setRecipients(handle.db, 1, ['a@x.de', 'b@x.de']);
  setMailLanguage(handle.db, 1, 'en');
  const mailer = createMailer({ transport, from: 'ss@x.de' });
  expect(await sendTestMail({ db: handle.db, ownerId: 1, mailer })).toEqual({
    ok: true,
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toEqual(['a@x.de', 'b@x.de']);
  expect(sent[0]?.from).toBe('ss@x.de');
  expect(sent[0]?.subject.length).toBeGreaterThan(0);
});

test('test mail errors without recipients', async () => {
  const mailer = createMailer({ transport, from: 'ss@x.de' });
  const res = await sendTestMail({ db: handle.db, ownerId: 1, mailer });
  expect(res.ok).toBe(false);
  expect(res.error).toBeTruthy();
  expect(sent).toHaveLength(0);
});

test('test mail reports transport errors', async () => {
  setRecipients(handle.db, 1, ['a@x.de']);
  const mailer = createMailer({
    transport: { sendMail: async () => Promise.reject(new Error('refused')) },
    from: 'ss@x.de',
  });
  expect(await sendTestMail({ db: handle.db, ownerId: 1, mailer })).toEqual({
    ok: false,
    error: 'refused',
  });
});
