import { Input, Label } from '@replaymark/ds';

export const Default = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="login">Twitch-Login</Label>
    <Input id="login" placeholder="z. B. gronkh" />
  </div>
);

export const States = () => (
  <div className="grid w-72 gap-3">
    <Input defaultValue="papaplatte" />
    <Input aria-invalid defaultValue="papa platte" />
    <Input disabled defaultValue="Gesperrt" />
  </div>
);
