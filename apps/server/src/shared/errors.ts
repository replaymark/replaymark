export const API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'forbidden_origin',
  'password_change_required',
  'invalid_setup_code',
  'setup_completed',
  'invalid_password',
  'rate_limited',
  'validation_failed',
  'not_found',
  'unknown_login',
  'unknown_category',
  'duplicate_name',
  'username_taken',
  'last_admin',
  'cannot_delete_self',
  'default_group_protected',
  'unknown_group',
  'twitch_unavailable',
  'mail_failed',
  'no_recipients',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Per-field validation messages, keyed by dotted path. */
    fields?: Record<string, string[]>;
  };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string[]>,
): ApiError {
  return { error: fields ? { code, message, fields } : { code, message } };
}
