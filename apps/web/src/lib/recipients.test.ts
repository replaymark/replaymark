import { describe, expect, it } from 'vitest';
import { recipientProblem } from './recipients.ts';

describe('recipientProblem', () => {
  it('accepts a new valid address, trimming blanks', () => {
    expect(recipientProblem('  me@example.com ', [])).toBeNull();
  });
  it('rejects invalid addresses', () => {
    expect(recipientProblem('', [])).toBe('invalid');
    expect(recipientProblem('me@', [])).toBe('invalid');
    expect(recipientProblem('me example.com', [])).toBe('invalid');
  });
  it('rejects case-insensitive duplicates', () => {
    expect(recipientProblem('Me@Example.com', ['me@example.com'])).toBe(
      'duplicate',
    );
  });
});
