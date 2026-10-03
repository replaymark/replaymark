import { useState } from 'react';
import { cn } from '@/lib/utils.ts';

function AvatarInner({
  url,
  name,
  size = 32,
  className,
}: {
  url: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  return url && !failed ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-full bg-paper object-cover', className)}
      style={style}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold text-muted-foreground',
        className,
      )}
      style={style}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function StreamerAvatar(props: {
  url: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  return <AvatarInner key={props.url ?? ''} {...props} />;
}
