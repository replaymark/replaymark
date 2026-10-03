import { Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import { boxArt } from '@/lib/boxart.ts';

type BoxArtProps = {
  url: string | null;
  width: number;
  height: number;
  className?: string;
};

function BoxArtImage({ url, width, height, className }: BoxArtProps) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img
      src={boxArt(url, width * 2, height * 2)}
      width={width}
      height={height}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-sm bg-paper object-cover ${className ?? ''}`}
      style={{ width, height }}
    />
  ) : (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-sm bg-paper text-muted-foreground ${className ?? ''}`}
      style={{ width, height }}
    >
      <Gamepad2 className="size-4" />
    </span>
  );
}

/** Box art with a neutral gamepad tile when missing or failing to load. */
export function BoxArt(props: BoxArtProps) {
  return <BoxArtImage key={props.url ?? ''} {...props} />;
}
