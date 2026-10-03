import { CircleAlert } from 'lucide-react';

/** First string error of a form field, with icon (errors never rely on colour alone). */
export function FieldError({ errors, id }: { errors: unknown[]; id?: string }) {
  const msg = errors.find((e) => typeof e === 'string');
  if (!msg) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-center gap-1.5 text-sm text-destructive"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {msg as string}
    </p>
  );
}
