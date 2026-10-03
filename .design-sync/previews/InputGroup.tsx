import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@replaymark/ds';
import { Search, X } from 'lucide-react';

export const Prefix = () => (
  <div className="w-80">
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>twitch.tv/</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="login" />
    </InputGroup>
  </div>
);

export const SearchWithClear = () => (
  <div className="w-80">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput defaultValue="Elden" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Leeren">
          <X />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

export const TextareaWithFooter = () => (
  <div className="w-80">
    <InputGroup>
      <InputGroupTextarea placeholder="Notiz zum Streamer…" />
      <InputGroupAddon align="block-end">
        <InputGroupText>0 / 280</InputGroupText>
        <InputGroupButton className="ml-auto" variant="default">
          Speichern
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
