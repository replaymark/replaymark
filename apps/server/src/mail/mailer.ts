import nodemailer from 'nodemailer';
import type { Db } from '../db/client.ts';
import { getMailLanguage, getRecipients } from '../db/settings.ts';
import { type Env, smtpTransportOptions } from '../env.ts';
import { renderTestMail } from './render.ts';

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  sendMail(msg: MailMessage): Promise<unknown>;
}

export function createTransport(env: Env): MailTransport {
  return nodemailer.createTransport(smtpTransportOptions(env));
}

export interface OutgoingMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export function createMailer(deps: {
  transport: MailTransport;
  from: string;
}): Mailer {
  return {
    async send(mail) {
      if (mail.to.length === 0) throw new Error('no recipients');
      await deps.transport.sendMail({ from: deps.from, ...mail });
    },
  };
}

export interface TestMailResult {
  ok: boolean;
  error?: string;
}

/** Sends the test mail directly (bypassing the outbox) to the account's recipients. */
export async function sendTestMail(deps: {
  db: Db;
  /** Account whose recipients and mail language apply. */
  ownerId: number;
  mailer: Mailer;
  /** PUBLIC_BASE_URL for the admin UI footer link. */
  adminUrl?: string;
}): Promise<TestMailResult> {
  const to = getRecipients(deps.db, deps.ownerId);
  if (to.length === 0) return { ok: false, error: 'no recipients configured' };
  try {
    const mail = renderTestMail(
      getMailLanguage(deps.db, deps.ownerId),
      deps.adminUrl,
    );
    await deps.mailer.send({ to, ...mail });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
