import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@replaymark/ds';

export const AddStreamer = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Streamer hinzufügen</DialogTitle>
        <DialogDescription>
          Gib den Twitch-Login ein. Benachrichtigungen starten sofort.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="dlg-login">Twitch-Login</Label>
        <Input id="dlg-login" placeholder="z. B. gronkh" />
      </div>
      <DialogFooter showCloseButton>
        <Button>Hinzufügen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
