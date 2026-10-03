---
category: Overlays
---

Modal dialog (10px radius – the only `rounded-xl` surface). Compose: `Dialog` (open / onOpenChange / defaultOpen) > `DialogTrigger` + `DialogContent` (`showCloseButton`, default true) > `DialogHeader` (`DialogTitle`, `DialogDescription`), body, `DialogFooter` (`showCloseButton` adds an outline "Close"). `DialogClose`, `DialogOverlay`, `DialogPortal` are available for custom setups.

## Example

```jsx
<Dialog>
  <DialogTrigger render={<Button variant="outline" />}>Streamer hinzufügen</DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>Streamer hinzufügen</DialogTitle><DialogDescription>Twitch-Login eingeben.</DialogDescription></DialogHeader>
    <Input placeholder="gronkh" />
    <DialogFooter><Button>Hinzufügen</Button></DialogFooter>
  </DialogContent>
</Dialog>
```
