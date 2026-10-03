import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Production hashes cost 128 MiB each; tests use a cheap scrypt cost.
    env: { REPLAYMARK_TEST_SCRYPT_N: '1024' },
  },
});
