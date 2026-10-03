import type {
  ChangePasswordInput,
  LoginInput,
  SetupInput,
} from '@shared/schemas.ts';
import { api, queryKeys, unwrap } from './api.ts';

export const meQuery = {
  queryKey: queryKeys.me,
  queryFn: () => unwrap(api.api.auth.me.$get()),
  staleTime: 60_000,
  retry: false,
} as const;

export const setupQuery = {
  queryKey: queryKeys.setup,
  queryFn: () => unwrap(api.api.auth.setup.$get()),
  // Setup never becomes required again once it is done: cache `false` for good.
  staleTime: (q: { state: { data?: { required: boolean } } }) =>
    q.state.data?.required === false ? Number.POSITIVE_INFINITY : 0,
  retry: false,
} as const;

export function submitSetup(json: SetupInput) {
  return unwrap(api.api.auth.setup.$post({ json }));
}

export function submitLogin(json: LoginInput) {
  return unwrap(api.api.auth.login.$post({ json }));
}

export function changePassword(json: ChangePasswordInput) {
  return unwrap(api.api.account.password.$post({ json }));
}
