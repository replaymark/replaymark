import { Separator } from '@replaymark/ds';

export const Horizontal = () => (
  <div className="w-72 text-sm">
    <p className="font-medium">Standardspiele</p>
    <p className="text-muted-foreground">
      Gelten für alle Streamer ohne eigene Auswahl.
    </p>
    <Separator className="my-3" />
    <p className="font-medium">Empfänger</p>
    <p className="text-muted-foreground">2 Adressen</p>
  </div>
);

export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-sm">
    <span>Übersicht</span>
    <Separator orientation="vertical" />
    <span>Timeline</span>
    <Separator orientation="vertical" />
    <span>Verlauf</span>
  </div>
);
