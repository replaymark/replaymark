// Builds the design-system package that /design-sync converts:
//   1. .d.ts tree (tsc), with the app's path aliases rewritten to relative
//      paths so the converter's type checker can follow them;
//   2. dist/css/replaymark.css - the compiled Tailwind stylesheet (app styles
//      + every class used by the app and the authored previews, plus a layout
//      safelist for designs), with Tailwind's internal --tw-* registrations
//      kept out of Claude Design's token list; the palette goes to
//      dist/tokens/tokens.css.
// Run from the repo root: node .design-sync/ds-package/build.mjs
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WEB = join(ROOT, 'apps/web');
const DIST = join(HERE, 'dist');
const TYPES = join(DIST, 'types');

rmSync(DIST, { recursive: true, force: true });

// -- 1. declarations -------------------------------------------------------
execFileSync(
  join(WEB, 'node_modules/.bin/tsc'),
  ['-p', join(HERE, 'tsconfig.json')],
  {
    cwd: WEB,
    stdio: 'inherit',
  },
);
const aliases = [
  ['@/', join(TYPES, 'apps/web/src')],
  ['@shared/', join(TYPES, 'apps/server/src/shared')],
  ['@server/', join(TYPES, 'apps/server/src')],
];
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(TYPES).filter((p) => p.endsWith('.d.ts'))) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(
    /(from\s+|import\()(['"])([^'"]+)\2/g,
    (_m, lead, q, spec) => {
      let s = spec;
      for (const [prefix, target] of aliases) {
        if (s.startsWith(prefix)) {
          s = relative(dirname(file), join(target, s.slice(prefix.length)));
          if (!s.startsWith('.')) s = `./${s}`;
          break;
        }
      }
      if (s.startsWith('.')) s = s.replace(/\.tsx?$/, '.js');
      return `${lead}${q}${s}${q}`;
    },
  );
  if (out !== src) writeFileSync(file, out);
}

// -- 2. stylesheet ---------------------------------------------------------
const req = createRequire(join(WEB, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('vite')).href);
const tailwind = (
  await import(pathToFileURL(req.resolve('@tailwindcss/vite')).href)
).default;
await build({
  root: WEB,
  configFile: false,
  logLevel: 'warn',
  base: './',
  plugins: [tailwind()],
  build: {
    outDir: join(DIST, 'css'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssMinify: false,
    rollupOptions: {
      input: join(HERE, 'ds.css'),
      output: { assetFileNames: '[name][extname]' },
    },
  },
});
const cssDir = join(DIST, 'css');
const built = join(cssDir, 'ds.css');
const postcss = createRequire(req.resolve('vite'))('postcss');
const root = postcss.parse(readFileSync(built, 'utf8'));
// Tailwind v4 registers its internal --tw-* variables in an `@layer properties`
// fallback that sets them on `*` for browsers without @property. Claude Design
// reads those as design tokens; every supported browser has @property, so the
// fallback goes.
root.walkAtRules('layer', (at) => {
  if (at.params === 'properties' && at.nodes?.length) at.remove();
});
// Inline the --tw-* helpers whose value never depends on another class, so
// fewer custom properties sit on utility selectors (Claude Design reports
// them). Substituting a var() with its value is exactly what the browser
// does, so this is lossless when either
//   (a) every rule that sets the var sets the same value as its @property
//       initial-value - e.g. --tw-space-y-reverse is always 0 because no
//       *-reverse utility is compiled: every var() read becomes that value;
//   (b) every rule that touches the var sets it and reads it in the same
//       properties - e.g. --tw-font-weight: the winning rule supplies both
//       the var and the property, so each rule reads its own value.
// Vars that compose across classes (ring + ring-color, translate-x +
// translate-y, duration + transition, text-* + leading-*) stay: dropping
// them would change rendering.
const norm = (v) => v.replace(/\s+/g, ' ').trim();
const initial = new Map();
root.walkAtRules('property', (at) => {
  const iv = at.nodes?.find(
    (n) => n.type === 'decl' && n.prop === 'initial-value',
  );
  if (at.params.startsWith('--tw-'))
    initial.set(at.params, iv ? norm(iv.value) : null);
});
const touching = new Map();
root.walkDecls((d) => {
  if (d.parent.type !== 'rule') return;
  const vars = new Set(
    [...d.value.matchAll(/var\((--tw-[\w-]+)/g)].map((m) => m[1]),
  );
  if (d.prop.startsWith('--tw-')) vars.add(d.prop);
  for (const v of vars) {
    const rules = touching.get(v) ?? new Set();
    rules.add(d.parent);
    touching.set(v, rules);
  }
});
const ownDecl = (rule, v) =>
  rule.nodes.find((n) => n.type === 'decl' && n.prop === v);
const readers = (rule, v) =>
  rule.nodes.filter(
    (n) =>
      n.type === 'decl' &&
      !n.prop.startsWith('--tw-') &&
      n.value.includes(`var(${v}`),
  );
const bareVar = (v) => new RegExp(`var\\(${v.replace(/[-]/g, '\\-')}\\)`, 'g');
let inlined = 0;
for (const [v, set] of touching) {
  const rules = [...set];
  const setters = rules.filter((r) => ownDecl(r, v));
  if (!setters.length) continue;
  // var() with a fallback or read by another --tw-* var can't be folded simply.
  const anyFallback = rules.some((r) =>
    r.nodes.some(
      (n) => n.type === 'decl' && new RegExp(`var\\(${v},`).test(n.value),
    ),
  );
  const readByVar = rules.some((r) =>
    r.nodes.some(
      (n) =>
        n.type === 'decl' &&
        n.prop.startsWith('--tw-') &&
        n.prop !== v &&
        n.value.includes(`var(${v}`),
    ),
  );
  if (anyFallback || readByVar) continue;
  const values = new Set(setters.map((r) => norm(ownDecl(r, v).value)));
  const constant = values.size === 1 && initial.get(v) === [...values][0];
  const selfContained =
    rules.every((r) => ownDecl(r, v)) &&
    new Set(
      rules.map((r) =>
        readers(r, v)
          .map((n) => n.prop)
          .sort()
          .join(),
      ),
    ).size === 1;
  if (!constant && !selfContained) continue;
  for (const r of rules) {
    const own = ownDecl(r, v);
    const value = constant ? [...values][0] : own.value;
    for (const n of readers(r, v)) n.value = n.value.replace(bareVar(v), value);
    if (own) {
      own.remove();
      inlined++;
    }
  }
}
console.log(`ds-package: inlined ${inlined} --tw-* declarations`);
// Single-class utilities that set --tw-* (`.font-bold{--tw-font-weight:..}`)
// read as token scopes/themes. `:is(.x)` has identical specificity and
// matching, but isn't a bare class selector.
const SINGLE_CLASS = /^\.(?:\\.|[\w-])+$/;
root.walkRules((rule) => {
  if (!SINGLE_CLASS.test(rule.selector)) return;
  if (rule.some((n) => n.type === 'decl' && n.prop.startsWith('--tw-'))) {
    rule.selector = `:is(${rule.selector})`;
  }
});
// Mark what isn't a theme token with a trailing `/* @kind other */` on the
// same line: Tailwind's non-theme defaults in @layer theme (animation,
// aspect ratio, transition defaults) and every internal --tw-* helper
// declared inside a utility rule.
const TW_DEFAULTS =
  /^--(?:animate-|aspect-|ease-|perspective-|default-transition-)/;
const markOther = (decl) => {
  const next = decl.next();
  if (next?.type === 'comment' && next.text === '@kind other') return;
  decl.after(
    postcss.comment({
      text: '@kind other',
      raws: { before: ' ', left: ' ', right: ' ' },
    }),
  );
};
root.walkDecls((decl) => {
  if (!decl.prop.startsWith('--')) return;
  const inTheme =
    decl.parent?.parent?.type === 'atrule' &&
    decl.parent.parent.name === 'layer' &&
    decl.parent.parent.params === 'theme';
  if (inTheme && TW_DEFAULTS.test(decl.prop)) markOther(decl);
  else if (!inTheme && decl.prop.startsWith('--tw-')) markOther(decl);
});
// The app's palette (unlayered :root / .dark blocks from styles.css) ships
// as tokens/tokens.css; Tailwind's own @layer theme scale stays in the bundle.
const tokens = postcss.root();
root.each((node) => {
  if (node.type === 'rule' && /^(:root|\.dark)$/.test(node.selector)) {
    tokens.append(node.clone());
    node.remove();
  }
});
// Repeat the semantic aliases (var(--paper) etc.) inside .dark so a nested
// `.dark` wrapper - not only <html class="dark"> - re-resolves them.
const rootBlock = tokens.nodes.find((n) => n.selector === ':root');
const darkBlock = tokens.nodes.find((n) => n.selector === '.dark');
if (rootBlock && darkBlock) {
  const own = new Set(
    darkBlock.nodes.filter((n) => n.type === 'decl').map((n) => n.prop),
  );
  rootBlock.each((n) => {
    if (n.type === 'decl' && n.value.includes('var(') && !own.has(n.prop))
      darkBlock.append(n.clone());
  });
}
const tokensDir = join(DIST, 'tokens');
mkdirSync(tokensDir, { recursive: true });
writeFileSync(
  join(tokensDir, 'tokens.css'),
  `/* replaymark palette - generated from apps/web/src/styles.css. Tally red (--live) is reserved for "live". Dark: .dark on <html> or any wrapper. */\n${tokens.toString()}\n`,
);
const css = root.toString();
writeFileSync(join(cssDir, 'replaymark.css'), css);
rmSync(built);
const left =
  root.toString().match(/(?:^|[;{])\s*--tw-[\w-]+\s*:/g)?.length ?? 0;
console.log(
  `ds-package: ${relative(ROOT, join(cssDir, 'replaymark.css'))} (${(css.length / 1024).toFixed(0)} KiB, ` +
    `${left} --tw-* declarations inside utilities), ${tokens.nodes.length} token blocks -> dist/tokens/tokens.css`,
);
