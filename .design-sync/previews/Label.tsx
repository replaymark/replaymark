import { Input, Label, Switch } from '@replaymark/ds';

export const WithInput = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="name">Anzeigename</Label>
    <Input id="name" defaultValue="Gronkh" />
  </div>
);

export const WithSwitch = () => (
  <div className="flex items-center gap-2">
    <Switch id="active" defaultChecked />
    <Label htmlFor="active">Streamer aktiv</Label>
  </div>
);
