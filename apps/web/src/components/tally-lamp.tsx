import { cn } from '@/lib/utils';

export function TallyLamp({
  live,
  size = 10,
  className,
  label,
}: {
  live: boolean;
  size?: number;
  className?: string;
  /** Accessible label; omit when the lamp is decorative. */
  label?: string;
}) {
  const common = {
    className: cn('tally-lamp shrink-0', className),
    'data-live': live,
    style: { width: size, height: size },
  };
  return label ? (
    <span {...common} role="img" aria-label={label} />
  ) : (
    <span {...common} aria-hidden />
  );
}
