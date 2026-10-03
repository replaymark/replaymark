import { StreamerAvatar } from '@replaymark/ds';

const AVATAR =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%23526a8f'/><circle cx='40' cy='32' r='14' fill='%23c9d3e3'/><rect x='16' y='52' width='48' height='28' rx='14' fill='%23c9d3e3'/></svg>";

export const WithImage = () => (
  <div className="flex items-center gap-3">
    <StreamerAvatar url={AVATAR} name="Gronkh" size={24} />
    <StreamerAvatar url={AVATAR} name="Gronkh" />
    <StreamerAvatar url={AVATAR} name="Gronkh" size={40} />
  </div>
);

export const Fallback = () => (
  <div className="flex items-center gap-3">
    <StreamerAvatar url={null} name="Papaplatte" size={24} />
    <StreamerAvatar url={null} name="Papaplatte" />
    <StreamerAvatar url={null} name="Papaplatte" size={40} />
  </div>
);

export const InList = () => (
  <ul className="w-64 divide-y surface">
    {[
      ['Gronkh', AVATAR],
      ['Papaplatte', null],
      ['Maxim', null],
    ].map(([n, u]) => (
      <li
        key={n as string}
        className="flex items-center gap-2 px-3 py-2 text-sm"
      >
        <StreamerAvatar url={u as string | null} name={n as string} />
        <span className="font-medium">{n}</span>
      </li>
    ))}
  </ul>
);
