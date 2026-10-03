---
category: Forms
---

Inline form error: shows the first string in `errors` with a crimson icon + text (errors never rely on colour alone); renders nothing when there is none. Give it an `id` and point the field's `aria-describedby` at it.

## Example

```jsx
<div className="grid gap-1.5">
  <Label htmlFor="mail">E-Mail</Label>
  <Input id="mail" aria-invalid aria-describedby="mail-err" defaultValue="gronkh@" />
  <FieldError id="mail-err" errors={['Bitte eine gültige E-Mail-Adresse eingeben.']} />
</div>
```
