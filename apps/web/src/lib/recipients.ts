import { z } from 'zod';

const email = z.email();

export type RecipientProblem = 'invalid' | 'duplicate';

export function normalizeRecipient(raw: string): string {
  return raw.trim();
}

/** Why `raw` cannot be added to `list`, or null if it can. Case-insensitive duplicates. */
export function recipientProblem(
  raw: string,
  list: readonly string[],
): RecipientProblem | null {
  const v = normalizeRecipient(raw);
  if (!email.safeParse(v).success) return 'invalid';
  const lower = v.toLowerCase();
  if (list.some((r) => r.toLowerCase() === lower)) return 'duplicate';
  return null;
}
