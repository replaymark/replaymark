import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${r('./src')}/`,
      '@shared/': `${r('../server/src/shared')}/`,
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
