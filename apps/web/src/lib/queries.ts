import type {
  Category,
  CreateGameGroupInput,
  CreateUserInput,
  GameGroup,
  NotificationStatus,
  PatchAccountInput,
  PatchGameGroupInput,
  PatchStreamerInput,
  PatchUserInput,
  Streamer,
} from '@shared/schemas.ts';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiClientError, api, queryKeys, unwrap } from './api.ts';
import { notificationsQueryParams } from './history.ts';
import { type TimelineSearch, timelineQueryParams } from './timeline.ts';

export const overviewQuery = queryOptions({
  queryKey: queryKeys.overview,
  queryFn: () => unwrap(api.api.overview.$get()),
});

export const streamersQuery = queryOptions({
  queryKey: queryKeys.streamers,
  queryFn: () => unwrap(api.api.streamers.$get()),
});

export function lookupQuery(login: string) {
  return queryOptions({
    queryKey: ['streamer-lookup', login] as const,
    queryFn: () => unwrap(api.api.streamers.lookup.$get({ query: { login } })),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function categorySearchQuery(q: string) {
  return queryOptions({
    queryKey: ['category-search', q.toLowerCase()] as const,
    queryFn: () => unwrap(api.api.categories.search.$get({ query: { q } })),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Error code for `t.error`, whatever was thrown. */
export function errorCode(err: unknown) {
  return err instanceof ApiClientError ? err.code : 'internal';
}

export function patchStreamer(id: string, json: PatchStreamerInput) {
  return unwrap(api.api.streamers[':id'].$patch({ param: { id }, json }));
}

/** Active switch: optimistic update with rollback on error. */
export function useToggleStreamer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      patchStreamer(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: queryKeys.streamers });
      const previous = qc.getQueryData<Streamer[]>(queryKeys.streamers);
      qc.setQueryData<Streamer[]>(queryKeys.streamers, (old) =>
        old?.map((s) => (s.id === id ? { ...s, enabled } : s)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.streamers, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.streamers });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export const subscriptionsQuery = queryOptions({
  queryKey: queryKeys.subscriptions,
  queryFn: () => unwrap(api.api.subscriptions.$get()),
});

export const settingsQuery = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => unwrap(api.api.settings.$get()),
});

export function notificationsQuery(search: {
  status?: NotificationStatus | NotificationStatus[];
  page?: number;
}) {
  const query = notificationsQueryParams(search);
  return queryOptions({
    queryKey: [...queryKeys.notifications, query] as const,
    // The RPC type shows the server-parsed status list; on the wire it is a comma string.
    queryFn: () =>
      unwrap(api.api.notifications.$get({ query: query as never })),
    placeholderData: keepPreviousData,
  });
}

/** Re-queues every failed mail; resolves with the number re-queued. */
export function retryFailedNotifications() {
  return unwrap(api.api.notifications['retry-failed'].$post());
}

export function timelineQuery(search: TimelineSearch) {
  const query = timelineQueryParams(search);
  return queryOptions({
    queryKey: [...queryKeys.timeline, 'list', query] as const,
    queryFn: () => unwrap(api.api.timeline.$get({ query })),
    placeholderData: keepPreviousData,
  });
}

export const recordedCategoriesQuery = queryOptions({
  queryKey: [...queryKeys.timeline, 'categories'] as const,
  queryFn: () => unwrap(api.api.timeline.categories.$get()),
});

export function streamDetailQuery(streamId: string) {
  return queryOptions({
    queryKey: [...queryKeys.timeline, 'stream', streamId] as const,
    queryFn: () =>
      unwrap(
        api.api.timeline.streams[':streamId'].$get({ param: { streamId } }),
      ),
  });
}

export const gameGroupsQuery = queryOptions({
  queryKey: queryKeys.gameGroups,
  queryFn: () => unwrap(api.api['game-groups'].$get()),
});

/** Group changes also change streamer mode lines, search and the overview. */
function useGroupMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gameGroups });
      void qc.invalidateQueries({ queryKey: queryKeys.streamers });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useCreateGameGroup() {
  return useGroupMutation((json: CreateGameGroupInput) =>
    unwrap(api.api['game-groups'].$post({ json })),
  );
}

const PATCH_GROUP_KEY = ['patch-game-group'] as const;

/**
 * Patches a group. Passing `games` applies the edit to the cache right away and
 * rolls back only this group on error, so quick chip edits do not undo each other.
 */
export function usePatchGameGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: PATCH_GROUP_KEY,
    mutationFn: ({
      id,
      json,
    }: {
      id: number;
      json: PatchGameGroupInput;
      games?: Category[];
    }) =>
      unwrap(
        api.api['game-groups'][':id'].$patch({
          param: { id: String(id) },
          json,
        }),
      ),
    onMutate: async ({ id, games }) => {
      if (!games) return { previous: undefined };
      await qc.cancelQueries({ queryKey: queryKeys.gameGroups });
      const previous = qc
        .getQueryData<GameGroup[]>(queryKeys.gameGroups)
        ?.find((g) => g.id === id);
      qc.setQueryData<GameGroup[]>(queryKeys.gameGroups, (list) =>
        list?.map((g) => (g.id === id ? { ...g, games } : g)),
      );
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      const previous = ctx?.previous;
      if (!previous) return;
      qc.setQueryData<GameGroup[]>(queryKeys.gameGroups, (list) =>
        list?.map((g) => (g.id === id ? previous : g)),
      );
    },
    onSettled: () => {
      // Another edit still in flight would be overwritten by this refetch.
      if (qc.isMutating({ mutationKey: PATCH_GROUP_KEY }) > 1) return;
      void qc.invalidateQueries({ queryKey: queryKeys.gameGroups });
      void qc.invalidateQueries({ queryKey: queryKeys.streamers });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useDeleteGameGroup() {
  return useGroupMutation((id: number) =>
    unwrap(
      api.api['game-groups'][':id'].$delete({ param: { id: String(id) } }),
    ),
  );
}

export const accountQuery = queryOptions({
  queryKey: queryKeys.account,
  queryFn: () => unwrap(api.api.account.$get()),
});

export function patchAccount(json: PatchAccountInput) {
  return unwrap(api.api.account.$patch({ json }));
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchAccount,
    onSuccess: (data) => qc.setQueryData(queryKeys.account, data),
  });
}

export const usersQuery = queryOptions({
  queryKey: queryKeys.users,
  queryFn: () => unwrap(api.api.users.$get()),
});

function useUsersMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useCreateUser() {
  return useUsersMutation((json: CreateUserInput) =>
    unwrap(api.api.users.$post({ json })),
  );
}

export function useUpdateUser() {
  return useUsersMutation(({ id, ...json }: { id: number } & PatchUserInput) =>
    unwrap(api.api.users[':id'].$patch({ param: { id: String(id) }, json })),
  );
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useUsersMutation(async (id: number) => {
    const res = await unwrap(
      api.api.users[':id'].$delete({ param: { id: String(id) } }),
    );
    // The deleted user's streamers and history are gone too.
    void qc.invalidateQueries({ queryKey: queryKeys.streamers });
    void qc.invalidateQueries({ queryKey: queryKeys.notifications });
    void qc.invalidateQueries({ queryKey: queryKeys.overview });
    return res;
  });
}
