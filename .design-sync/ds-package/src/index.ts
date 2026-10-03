// Design-system entry for Claude Design (/design-sync). Re-exports the web
// app's presentational components; app-level pieces (AppShell, dialogs bound
// to queries, CategoryPicker) are deliberately left out.

export { toast } from 'sonner';
export { FieldError } from '../../../apps/web/src/components/field-error.tsx';
export { StreamerAvatar } from '../../../apps/web/src/components/streamer-avatar.tsx';
export { TallyLamp } from '../../../apps/web/src/components/tally-lamp.tsx';
export {
  LiveBadge,
  SegmentRow,
  SegmentStrip,
  StreamHead,
  VodState,
} from '../../../apps/web/src/components/timeline.tsx';
export {
  Badge,
  badgeVariants,
} from '../../../apps/web/src/components/ui/badge.tsx';
export {
  Button,
  buttonVariants,
} from '../../../apps/web/src/components/ui/button.tsx';
export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from '../../../apps/web/src/components/ui/combobox.tsx';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '../../../apps/web/src/components/ui/dialog.tsx';
export { Input } from '../../../apps/web/src/components/ui/input.tsx';
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '../../../apps/web/src/components/ui/input-group.tsx';
export { Label } from '../../../apps/web/src/components/ui/label.tsx';
export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../../../apps/web/src/components/ui/popover.tsx';
export {
  RadioGroup,
  RadioGroupItem,
} from '../../../apps/web/src/components/ui/radio-group.tsx';
export { Separator } from '../../../apps/web/src/components/ui/separator.tsx';
export { Toaster } from '../../../apps/web/src/components/ui/sonner.tsx';
export { Switch } from '../../../apps/web/src/components/ui/switch.tsx';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../apps/web/src/components/ui/table.tsx';
export { Textarea } from '../../../apps/web/src/components/ui/textarea.tsx';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../apps/web/src/components/ui/tooltip.tsx';
export { ReplaymarkProvider } from './provider.tsx';
