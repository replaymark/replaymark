import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@replaymark/ds';
import { Info } from 'lucide-react';

export const OnIconButton = () => (
  <div className="flex h-28 w-72 items-end justify-center">
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Info" />}
      >
        <Info />
      </TooltipTrigger>
      <TooltipContent>VOD wird noch verarbeitet</TooltipContent>
    </Tooltip>
  </div>
);
