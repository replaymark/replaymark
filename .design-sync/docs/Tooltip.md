---
category: Overlays
---

Short explanatory hint on hover/focus: `Tooltip` > `TooltipTrigger` (use `render` to supply the element) + `TooltipContent` (`side`). Needs `TooltipProvider`, which `ReplaymarkProvider` already includes.

## Example

```jsx
<Tooltip>
  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Info" />}>i</TooltipTrigger>
  <TooltipContent>VOD noch nicht verfügbar</TooltipContent>
</Tooltip>
```
