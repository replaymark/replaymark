import { FieldError, Input, Label } from '@replaymark/ds';

export const OnField = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="mail">E-Mail</Label>
    <Input
      id="mail"
      aria-invalid
      aria-describedby="mail-err"
      defaultValue="gronkh@"
    />
    <FieldError
      id="mail-err"
      errors={['Bitte eine gültige E-Mail-Adresse eingeben.']}
    />
  </div>
);

export const Standalone = () => (
  <FieldError
    errors={[undefined, 'Dieser Streamer existiert nicht auf Twitch.']}
  />
);
