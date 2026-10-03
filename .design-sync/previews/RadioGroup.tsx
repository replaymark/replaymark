import { Label, RadioGroup, RadioGroupItem } from '@replaymark/ds';

export const Theme = () => (
  <RadioGroup defaultValue="system" className="w-56">
    {[
      ['light', 'Hell'],
      ['dark', 'Dunkel'],
      ['system', 'System'],
    ].map(([v, l]) => (
      <div key={v} className="flex items-center gap-2">
        <RadioGroupItem value={v} id={`t-${v}`} />
        <Label htmlFor={`t-${v}`}>{l}</Label>
      </div>
    ))}
  </RadioGroup>
);

export const Disabled = () => (
  <RadioGroup defaultValue="mail" disabled className="w-56">
    <div className="flex items-center gap-2">
      <RadioGroupItem value="mail" id="d-m" />
      <Label htmlFor="d-m">E-Mail</Label>
    </div>
    <div className="flex items-center gap-2">
      <RadioGroupItem value="push" id="d-p" />
      <Label htmlFor="d-p">Push</Label>
    </div>
  </RadioGroup>
);
