import { expect, test } from 'vitest';
import { name } from '../src/index.ts';

test('exports the app name', () => {
  expect(name).toBe('replaymark');
});
