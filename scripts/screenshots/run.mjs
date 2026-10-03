// Reproducible README screenshots: `pnpm screenshots`.
//
// Starts the real server against a throwaway DATA_DIR with dummy Twitch/SMTP
// settings and with outgoing fetch disabled (no-network.mjs), completes the
// first-run setup, seeds fictional demo data and captures docs/images/*.png.
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { seedDemo } from './seed.mjs';

const root = resolve(import.meta.dirname, '../..');
const outDir = join(root, 'docs/images');
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const ADMIN = {
  username: 'admin',
  email: 'admin@example.com',
  password: 'demo-password-123',
};

const BROWSER_ENV = {
  ...process.env,
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US',
  LC_ALL: 'en_US.UTF-8',
};

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${what}`);
}

function buildWeb() {
  const r = spawnSync('pnpm', ['--filter', '@replaymark/web', 'build'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('web build failed');
}

let activeChild;

async function startServer(dataDir) {
  const [publicPort, adminPort, internalPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  // Explicit environment only: nothing from the operator's shell or .env leaks in.
  const env = {
    PATH: process.env.PATH,
    TWITCH_CLIENT_ID: 'demo',
    TWITCH_CLIENT_SECRET: 'demo-secret',
    TWITCH_WEBHOOK_SECRET: 'demo-webhook-secret',
    TWITCH_CALLBACK_URL: 'https://demo.invalid/twitch/eventsub',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '9',
    SMTP_SECURITY: 'none',
    SMTP_FROM: 'replaymark@example.com',
    ADMIN_COOKIE_SECURE: 'false',
    DATA_DIR: dataDir,
    TZ: 'UTC',
    LOG_LEVEL: 'info',
    PUBLIC_PORT: String(publicPort),
    ADMIN_PORT: String(adminPort),
    INTERNAL_PORT: String(internalPort),
  };
  const child = spawn(
    process.execPath,
    [
      '--import',
      join(import.meta.dirname, 'no-network.mjs'),
      'apps/server/src/index.ts',
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  activeChild = child;
  let log = '';
  const collect = (d) => {
    log += d.toString();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', (code) => {
    if (code) console.error(`server exited with ${code}\n${log}`);
  });
  let code;
  try {
    code = await until(
      () => /Setup code: ([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(log)?.[1],
      'setup code',
    );
    await until(
      async () =>
        (
          await fetch(`http://127.0.0.1:${internalPort}/healthz`).catch(
            () => null,
          )
        )?.status !== undefined,
      'healthz',
    );
    // The startup reconcile fails against the disabled network; let it finish before seeding.
    await until(() => log.includes('first reconcile'), 'startup reconcile');
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }
  return {
    child,
    code,
    admin: `http://127.0.0.1:${adminPort}`,
    getLog: () => log,
  };
}

async function settle(page) {
  await page.waitForLoadState('load');
  await page.locator('main, form').first().waitFor();
  await page
    .waitForFunction(
      () => [...document.images].every((i) => i.complete),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await sleep(700);
}

async function capture(page, name) {
  await page.screenshot({ path: join(outDir, name) });
  console.log(`wrote ${name}`);
}

function newContext(browser, base, viewport, theme) {
  return browser
    .newContext({
      baseURL: base,
      viewport,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: theme,
      reducedMotion: 'reduce',
    })
    .then(async (ctx) => {
      await ctx.addInitScript((t) => {
        localStorage.setItem('replaymark.lang', 'en');
        localStorage.setItem('replaymark.theme', t);
      }, theme);
      return ctx;
    });
}

async function launch() {
  try {
    return await chromium.launch({ args: ['--lang=en-US'], env: BROWSER_ENV });
  } catch {
    return await chromium.launch({
      channel: 'chrome',
      args: ['--lang=en-US'],
      env: BROWSER_ENV,
    });
  }
}

async function socialPreview(browser) {
  const font = (pkg, file) =>
    readFileSync(
      join(
        root,
        'apps/web/node_modules/@fontsource-variable',
        pkg,
        'files',
        file,
      ),
    ).toString('base64');
  const body = font(
    'atkinson-hyperlegible-next',
    'atkinson-hyperlegible-next-latin-wght-normal.woff2',
  );
  const logo = readFileSync(
    join(root, 'docs/images/logo/logo-dark.svg'),
  ).toString('base64');
  const shot = readFileSync(join(outDir, 'overview-dark.png')).toString(
    'base64',
  );
  const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:B;src:url(data:font/woff2;base64,${body});font-weight:200 800}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:640px;overflow:hidden;background:#10141d;color:#eceef2;font-family:B,sans-serif;position:relative}
.text{position:absolute;left:72px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center;gap:28px}
h1{line-height:0}
h1 img{height:96px;display:block}
p{font-size:30px;line-height:1.3;color:#b8c0d0}
.shot{position:absolute;left:640px;top:96px;width:900px;height:562px;border-radius:14px 0 0 0;border:1px solid #2a3244;overflow:hidden;box-shadow:0 20px 60px #0008}
.shot img{width:900px;display:block}
</style><div class="text"><h1><img alt="replaymark" src="data:image/svg+xml;base64,${logo}"></h1><p>Get an email when your streamers go live in the games you care about.</p></div>
<div class="shot"><img src="data:image/png;base64,${shot}"></div>`;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await capture(page, 'social-preview.png');
  await page.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  buildWeb();
  const dataDir = mkdtempSync(join(tmpdir(), 'replaymark-shots-'));
  let server;
  let browser;
  // Ctrl-C: stop the server before the temp dir disappears underneath it.
  const onSigint = () => {
    activeChild?.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', onSigint);
  try {
    server = await startServer(dataDir);
    const base = server.admin;
    browser = await launch();

    // Setup page first, before the account exists.
    const ctx = await newContext(browser, base, DESKTOP, 'light');
    const page = await ctx.newPage();
    await page.goto('/setup');
    await page.getByLabel(/setup code/i).fill(server.code);
    await settle(page);
    await capture(page, 'setup.png');
    await ctx.close();

    const res = await fetch(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ code: server.code, ...ADMIN }),
    });
    if (!res.ok) throw new Error(`setup failed: ${res.status}`);
    const seeded = seedDemo(join(dataDir, 'replaymark.db'), Date.now());
    console.log(`seeded ${seeded.streamers} streamers`);

    const session = async (viewport, theme) => {
      const c = await newContext(browser, base, viewport, theme);
      const login = await c.request.post('/api/auth/login', {
        data: { username: ADMIN.username, password: ADMIN.password },
        headers: { origin: base },
      });
      if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
      return { c, p: await c.newPage() };
    };
    const shoot = async (p, path, name, scrollY = 0) => {
      await p.goto(path);
      await settle(p);
      if (scrollY === 'full') {
        // Tall viewport instead of fullPage, so the sticky save bar sits at the bottom.
        const height = await p.evaluate(
          () => document.documentElement.scrollHeight,
        );
        await p.setViewportSize({ width: DESKTOP.width, height });
        await sleep(300);
        await p.screenshot({ path: join(outDir, name) });
        console.log(`wrote ${name}`);
        return;
      }
      if (scrollY) {
        await p.evaluate((y) => window.scrollTo(0, y), scrollY);
        await sleep(300);
      }
      await capture(p, name);
    };

    {
      const { c, p } = await session(DESKTOP, 'dark');
      await shoot(p, '/', 'overview-dark.png');
      await c.close();
    }
    {
      const { c, p } = await session(DESKTOP, 'light');
      await shoot(p, '/', 'overview-light.png');
      await p.getByRole('button', { name: 'Edit QuietFox' }).first().click();
      await p.getByRole('dialog').waitFor();
      await sleep(600);
      await capture(p, 'streamer-dialog.png');
      await shoot(p, '/games', 'games.png');
      await shoot(p, '/timeline?categoryId=512953', 'timeline.png', 520);
      await shoot(p, '/history', 'history.png');
      await shoot(p, '/users', 'users.png');
      await shoot(p, '/settings', 'settings.png', 'full');
      await c.close();
    }
    {
      const { c, p } = await session(PHONE, 'light');
      await shoot(p, '/', 'overview-phone.png');
      await c.close();
    }
    await socialPreview(browser);
    optimize();
    report();
  } finally {
    process.off('SIGINT', onSigint);
    await browser?.close();
    if (server) {
      server.child.kill('SIGTERM');
      await sleep(500);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function optimize() {
  for (const tool of [
    ['oxipng', ['-o', '4', '--strip', 'safe']],
    ['pngquant', ['--force', '--ext', '.png', '--skip-if-larger']],
  ]) {
    if (spawnSync('which', [tool[0]]).status !== 0) continue;
    const files = IMAGES.map((n) => join(outDir, n));
    spawnSync(tool[0], [...tool[1], ...files], { stdio: 'inherit' });
    return;
  }
}

const IMAGES = [
  'overview-dark.png',
  'overview-light.png',
  'games.png',
  'streamer-dialog.png',
  'timeline.png',
  'history.png',
  'users.png',
  'settings.png',
  'setup.png',
  'overview-phone.png',
  'social-preview.png',
];

function report() {
  for (const n of IMAGES) {
    const kb = Math.round(statSync(join(outDir, n)).size / 1024);
    console.log(`${n}: ${kb} KB${kb > 400 ? '  (over budget)' : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
