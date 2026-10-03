import { Button } from '@replaymark/ds';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Speichern</Button>
    <Button variant="outline">Abbrechen</Button>
    <Button variant="secondary">Vorschau</Button>
    <Button variant="ghost">Zurücksetzen</Button>
    <Button variant="destructive">Entfernen</Button>
    <Button variant="link">Details</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="xs">Extra klein</Button>
    <Button size="sm">Klein</Button>
    <Button>Standard</Button>
    <Button size="lg">Groß</Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>
      <Plus /> Streamer hinzufügen
    </Button>
    <Button variant="outline" size="sm">
      <RefreshCw /> Neu laden
    </Button>
    <Button variant="outline" size="icon" aria-label="Löschen">
      <Trash2 />
    </Button>
    <Button variant="ghost" size="icon-sm" aria-label="Hinzufügen">
      <Plus />
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex items-center gap-2">
    <Button disabled>Speichern</Button>
    <Button variant="outline" disabled>
      Abbrechen
    </Button>
  </div>
);
