import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const adminPort = process.env.ADMIN_PORT ?? '8081';

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@/': `${r('./src')}/`,
      '@shared/': `${r('../server/src/shared')}/`,
      '@server/': `${r('../server/src')}/`,
    },
  },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${adminPort}`,
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
