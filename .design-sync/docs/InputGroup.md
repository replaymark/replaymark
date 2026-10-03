---
category: Forms
---

Input with attached addons: `InputGroup` > `InputGroupInput` (or `InputGroupTextarea`) plus `InputGroupAddon` (`align`: `inline-start`, `inline-end`, `block-start`, `block-end`) holding `InputGroupText` or `InputGroupButton` (`size`: `xs`, `sm`, `icon-xs`, `icon-sm`).

## Example

```jsx
<InputGroup>
  <InputGroupAddon><InputGroupText>twitch.tv/</InputGroupText></InputGroupAddon>
  <InputGroupInput placeholder="login" />
</InputGroup>
```
