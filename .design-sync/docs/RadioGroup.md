---
category: Forms
---

Exclusive choice: `RadioGroup` (value / defaultValue / onValueChange) with `RadioGroupItem` children, each next to a `Label`.

## Example

```jsx
<RadioGroup defaultValue="system">
  <div className="flex items-center gap-2"><RadioGroupItem value="light" id="t-l" /><Label htmlFor="t-l">Hell</Label></div>
  <div className="flex items-center gap-2"><RadioGroupItem value="dark" id="t-d" /><Label htmlFor="t-d">Dunkel</Label></div>
  <div className="flex items-center gap-2"><RadioGroupItem value="system" id="t-s" /><Label htmlFor="t-s">System</Label></div>
</RadioGroup>
```
