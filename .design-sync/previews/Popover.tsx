import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Switch,
} from '@replaymark/ds';

export const Filter = () => (
  <div className="h-56 w-80">
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Filter
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Timeline filtern</PopoverTitle>
          <PopoverDescription>Nur Streams mit VOD anzeigen.</PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center gap-2">
          <Switch id="pf" defaultChecked />
          <Label htmlFor="pf">Mit VOD</Label>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);
