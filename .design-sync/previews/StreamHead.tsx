import { Button, StreamHead, VodState } from '@replaymark/ds';

const now = new Date('2026-09-27T23:40:00').getTime();
const h = 3600e3;
const seg = (
  id: string,
  name: string,
  from: number,
  to: number | null,
  extra = {},
) => ({
  categoryId: id,
  categoryName: name,
  boxArtUrl: null,
  startedAt: now - from * h,
  endedAt: to === null ? null : now - to * h,
  durationMs: ((to === null ? 0 : -to) + from) * h,
  startApprox: false,
  endApprox: false,
  muted: false,
  link: 'https://www.twitch.tv/videos/2270000000?t=0h0m0s',
  ...extra,
});
const segments = [
  seg('509658', 'Just Chatting', 4, 3.4),
  seg('512953', 'Elden Ring', 3.4, 1.2, { muted: true }),
  seg('509658', 'Just Chatting', 1.2, 0.9),
  seg('27471', 'Minecraft', 0.9, null, { link: null, startApprox: true }),
];
const broadcaster = {
  id: '12875057',
  login: 'gronkh',
  displayName: 'Gronkh',
  avatarUrl: null,
};
const live = {
  streamId: 's1',
  broadcaster,
  startedAt: now - 4 * h,
  endedAt: null,
  endApprox: false,
  live: true,
  vodState: 'available' as const,
  vodUrl: null,
  segments,
};
const ended = {
  ...live,
  streamId: 's2',
  broadcaster: {
    ...broadcaster,
    id: '2',
    login: 'papaplatte',
    displayName: 'Papaplatte',
  },
  live: false,
  endedAt: now - 0.5 * h,
  endApprox: true,
  vodState: 'pending' as const,
};

export const Live = () => (
  <div className="w-[560px]">
    <StreamHead stream={live} now={now}>
      <VodState state="available" />
    </StreamHead>
  </div>
);

export const Ended = () => (
  <div className="w-[560px]">
    <StreamHead stream={ended} now={now}>
      <VodState state="pending" />
    </StreamHead>
  </div>
);

export const DetailPage = () => (
  <div className="w-[560px]">
    <StreamHead stream={live} now={now} as="h1">
      <Button variant="outline" size="sm">
        Zur Timeline
      </Button>
    </StreamHead>
  </div>
);
