import { Label, Switch } from '@replaymark/ds';

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2">
      <Switch id="s1" defaultChecked />
      <Label htmlFor="s1">Benachrichtigungen aktiv</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="s2" />
      <Label htmlFor="s2">Nur bei Spielwechsel</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="s3" disabled defaultChecked />
      <Label htmlFor="s3">Gesperrt</Label>
    </div>
  </div>
);

export const Small = () => (
  <div className="flex items-center gap-2">
    <Switch id="s4" size="sm" defaultChecked />
    <Label htmlFor="s4">Kompakt</Label>
  </div>
);
