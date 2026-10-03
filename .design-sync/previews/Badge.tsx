import { Badge } from '@replaymark/ds';
import { Check, CircleAlert } from 'lucide-react';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>3 aktiv</Badge>
    <Badge variant="secondary">Pausiert</Badge>
    <Badge variant="outline">Just Chatting</Badge>
    <Badge variant="destructive">Fehlgeschlagen</Badge>
    <Badge variant="ghost">Entwurf</Badge>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="outline">
      <Check data-icon="inline-start" /> Zugestellt
    </Badge>
    <Badge variant="destructive">
      <CircleAlert data-icon="inline-start" /> 1 Fehler
    </Badge>
  </div>
);
