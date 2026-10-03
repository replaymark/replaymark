import { TallyLamp } from '@replaymark/ds';

export const States = () => (
  <div className="flex items-center gap-6 text-sm">
    <span className="inline-flex items-center gap-2">
      <TallyLamp live label="Live" /> Live
    </span>
    <span className="inline-flex items-center gap-2">
      <TallyLamp live={false} label="Offline" /> Offline
    </span>
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-4">
    <TallyLamp live size={6} />
    <TallyLamp live />
    <TallyLamp live size={14} />
    <TallyLamp live size={20} />
  </div>
);

export const InStreamerList = () => (
  <ul className="w-60 divide-y surface">
    {[
      ['Gronkh', true],
      ['Papaplatte', false],
      ['Maxim', true],
    ].map(([n, l]) => (
      <li
        key={n as string}
        className="flex items-center gap-2 px-3 py-2 text-sm"
      >
        <TallyLamp live={l as boolean} label={l ? 'Live' : 'Offline'} />
        <span className="font-medium">{n}</span>
      </li>
    ))}
  </ul>
);
