import { LiveBadge } from '@replaymark/ds';

export const Default = () => <LiveBadge />;

export const NextToName = () => (
  <div className="flex items-center gap-2">
    <span className="font-display text-xl leading-tight font-bold">Gronkh</span>
    <LiveBadge />
  </div>
);
