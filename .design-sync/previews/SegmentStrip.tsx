import { SegmentStrip } from '@replaymark/ds';

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

export const Highlighted = () => (
  <div className="w-[520px]">
    <SegmentStrip segments={segments} now={now} highlightId="512953" />
  </div>
);

export const LiveTail = () => (
  <div className="w-[520px]">
    <SegmentStrip segments={segments} now={now} highlightId="27471" />
  </div>
);
