import { describe, expect, test } from 'vitest';
import {
  formatDateTime,
  renderNotificationMail,
  renderTestMail,
} from '../src/mail/render.ts';

const base = {
  displayName: 'Streamer',
  login: 'streamer',
  gameName: 'Elden Ring',
  title: 'Boss fights',
  at: Date.UTC(2026, 0, 15, 17, 5),
  timeZone: 'Europe/Berlin',
};

describe('renderNotificationMail', () => {
  test('German subject and body', () => {
    const m = renderNotificationMail({ ...base, lang: 'de' });
    expect(m.subject).toBe('🔴 Streamer spielt jetzt Elden Ring');
    for (const part of [m.text, m.html]) {
      expect(part).toContain('Streamer');
      expect(part).toContain('Elden Ring');
      expect(part).toContain('Boss fights');
      expect(part).toContain('https://twitch.tv/streamer');
      expect(part).toContain('15.01.2026 18:05');
    }
    expect(m.html).toContain('prefers-color-scheme');
  });

  test('English subject', () => {
    const m = renderNotificationMail({ ...base, lang: 'en' });
    expect(m.subject).toBe('🔴 Streamer is now playing Elden Ring');
    expect(m.text).toContain('15.01.2026 18:05');
  });

  test('escapes user values in HTML', () => {
    const m = renderNotificationMail({
      ...base,
      lang: 'en',
      displayName: '<b>x</b>',
      title: '"a" & <script>alert(1)</script>',
      gameName: "Tom's <Game>",
      boxArtUrl: 'https://img.test/a-{width}x{height}.jpg?"x"',
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&quot;a&quot; &amp;');
    expect(m.html).toContain('Tom&#39;s &lt;Game&gt;');
    expect(m.html).toContain('a-144x192.jpg?&quot;x&quot;');
    expect(m.html).toContain('width="144" height="192"');
  });

  test('no box art without url', () => {
    const m = renderNotificationMail({ ...base, lang: 'de' });
    expect(m.html).not.toContain('<img');
  });
});

describe('formatDateTime', () => {
  test('Europe/Berlin winter (CET) and summer (CEST)', () => {
    expect(formatDateTime(Date.UTC(2026, 0, 5, 8, 3), 'Europe/Berlin')).toBe(
      '05.01.2026 09:03',
    );
    expect(formatDateTime(Date.UTC(2026, 6, 5, 8, 3), 'Europe/Berlin')).toBe(
      '05.07.2026 10:03',
    );
    // DST switch 2026-03-29 01:00 UTC.
    expect(formatDateTime(Date.UTC(2026, 2, 29, 0, 59), 'Europe/Berlin')).toBe(
      '29.03.2026 01:59',
    );
    expect(formatDateTime(Date.UTC(2026, 2, 29, 1, 0), 'Europe/Berlin')).toBe(
      '29.03.2026 03:00',
    );
    expect(formatDateTime(Date.UTC(2026, 0, 1, 23, 30), 'Europe/Berlin')).toBe(
      '02.01.2026 00:30',
    );
  });
});

test('renderTestMail in both languages', () => {
  expect(renderTestMail('de').subject).toMatch(/Test/);
  expect(renderTestMail('en').text).toMatch(/test email/);
});

describe('admin UI footer link', () => {
  const url = 'https://ss.example/?a=1&b=2';
  const cases = [
    ['de', 'Im Admin-UI öffnen'],
    ['en', 'Open admin UI'],
  ] as const;

  test.each(cases)(
    '%s: present in notification and test mail when set',
    (lang, label) => {
      for (const m of [
        renderNotificationMail({ ...base, lang, adminUrl: url }),
        renderTestMail(lang, url),
      ]) {
        expect(m.text).toContain(`${label}: ${url}`);
        expect(m.html).toContain(
          `<a href="https://ss.example/?a=1&amp;b=2" style="color:#9146ff;">${label}</a>`,
        );
        expect(m.html).not.toContain('a=1&b=2');
      }
    },
  );

  test.each(cases)('%s: absent when unset', (lang, label) => {
    for (const m of [
      renderNotificationMail({ ...base, lang }),
      renderTestMail(lang),
    ]) {
      expect(m.text).not.toContain(label);
      expect(m.html).not.toContain(label);
    }
  });
});
