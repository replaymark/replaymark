import { Label, Textarea } from '@replaymark/ds';

export const Default = () => (
  <div className="grid w-80 gap-1.5">
    <Label htmlFor="note">Notiz</Label>
    <Textarea
      id="note"
      placeholder="Worauf soll bei diesem Streamer geachtet werden?"
    />
  </div>
);

export const Filled = () => (
  <div className="grid w-80 gap-3">
    <Textarea
      defaultValue={
        'Streamt meist ab 20 Uhr.\nSpielwechsel oft nach Mitternacht.'
      }
    />
    <Textarea aria-invalid defaultValue="x" />
  </div>
);
