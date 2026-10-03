import type { MailLanguage } from '../db/settings.ts';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export interface NotificationMailInput {
  lang: MailLanguage;
  displayName: string;
  login: string;
  gameName: string;
  title: string;
  boxArtUrl?: string | null;
  /** Epoch ms. */
  at: number;
  timeZone: string;
  /** PUBLIC_BASE_URL; adds an admin UI footer link when set. */
  adminUrl?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `dd.MM.yyyy HH:mm` in `timeZone`, built from Intl parts. */
export function formatDateTime(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

const STRINGS = {
  de: {
    subject: (n: string, g: string) => `🔴 ${n} spielt jetzt ${g}`,
    heading: (n: string) => `${n} ist live`,
    game: 'Spiel',
    title: 'Titel',
    time: 'Zeit',
    watch: 'Jetzt ansehen',
    admin: 'Im Admin-UI öffnen',
    testSubject: 'Replaymark Test-Mail',
    testBody:
      'Dies ist eine Test-Mail von Replaymark. Der Versand funktioniert.',
  },
  en: {
    subject: (n: string, g: string) => `🔴 ${n} is now playing ${g}`,
    heading: (n: string) => `${n} is live`,
    game: 'Game',
    title: 'Title',
    time: 'Time',
    watch: 'Watch now',
    admin: 'Open admin UI',
    testSubject: 'Replaymark test email',
    testBody: 'This is a test email from Replaymark. Delivery works.',
  },
} as const;

const STYLE = `<style>
@media (prefers-color-scheme: dark) {
  .ss-body { background:#0e0e10 !important; color:#efeff1 !important; }
  .ss-card { background:#18181b !important; color:#efeff1 !important; }
  .ss-muted { color:#adadb8 !important; }
}
</style>`;

function layout(lang: MailLanguage, subject: string, inner: string): string {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title>${STYLE}</head>
<body class="ss-body" style="margin:0;padding:24px;background:#f4f4f5;color:#0e0e10;font-family:Arial,Helvetica,sans-serif;">
<div class="ss-card" style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px;">
${inner}
</div></body></html>`;
}

function adminFooterText(lang: MailLanguage, adminUrl?: string): string {
  return adminUrl ? `\n${STRINGS[lang].admin}: ${adminUrl}\n` : '';
}

function adminFooterHtml(lang: MailLanguage, adminUrl?: string): string {
  if (!adminUrl) return '';
  return `\n<p class="ss-muted" style="margin:16px 0 0 0;font-size:12px;color:#53535f;"><a href="${escapeHtml(adminUrl)}" style="color:#9146ff;">${escapeHtml(STRINGS[lang].admin)}</a></p>`;
}

export function renderNotificationMail(
  input: NotificationMailInput,
): RenderedMail {
  const t = STRINGS[input.lang];
  const subject = t.subject(input.displayName, input.gameName);
  const url = `https://twitch.tv/${encodeURIComponent(input.login)}`;
  const when = formatDateTime(input.at, input.timeZone);
  const text =
    [
      t.heading(input.displayName),
      '',
      `${t.game}: ${input.gameName}`,
      `${t.title}: ${input.title}`,
      `${t.time}: ${when}`,
      '',
      `${t.watch}: ${url}`,
      '',
    ].join('\n') + adminFooterText(input.lang, input.adminUrl);
  const e = escapeHtml;
  const art = input.boxArtUrl
    ? `<img src="${e(input.boxArtUrl.replace('{width}', '144').replace('{height}', '192'))}" width="144" height="192" alt="${e(input.gameName)}" style="display:block;width:144px;height:192px;border-radius:4px;margin:0 0 16px 0;">`
    : '';
  const html = layout(
    input.lang,
    subject,
    `${art}<h1 style="margin:0 0 12px 0;font-size:20px;">${e(t.heading(input.displayName))}</h1>
<p style="margin:0 0 6px 0;"><strong>${t.game}:</strong> ${e(input.gameName)}</p>
<p style="margin:0 0 6px 0;"><strong>${t.title}:</strong> ${e(input.title)}</p>
<p class="ss-muted" style="margin:0 0 16px 0;color:#53535f;"><strong>${t.time}:</strong> ${e(when)}</p>
<p style="margin:0;"><a href="${e(url)}" style="display:inline-block;padding:10px 16px;background:#9146ff;color:#ffffff;text-decoration:none;border-radius:4px;">${t.watch}</a></p>
<p class="ss-muted" style="margin:12px 0 0 0;font-size:12px;color:#53535f;">${e(url)}</p>${adminFooterHtml(input.lang, input.adminUrl)}`,
  );
  return { subject, text, html };
}

export function renderTestMail(
  lang: MailLanguage,
  adminUrl?: string,
): RenderedMail {
  const t = STRINGS[lang];
  return {
    subject: t.testSubject,
    text: `${t.testBody}\n${adminFooterText(lang, adminUrl)}`,
    html: layout(
      lang,
      t.testSubject,
      `<p style="margin:0;">${escapeHtml(t.testBody)}</p>${adminFooterHtml(lang, adminUrl)}`,
    ),
  };
}
