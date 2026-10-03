---
category: Data display
---

Plain data table: `Table` > `TableHeader` > `TableRow` > `TableHead`, then `TableBody` > `TableRow` > `TableCell`; optional `TableFooter`, `TableCaption`. Put it inside a `surface` card; use `tabular` on time/number cells.

## Example

```jsx
<Table>
  <TableHeader>
    <TableRow><TableHead>Streamer</TableHead><TableHead>Spiel</TableHead><TableHead className="text-right">Zeit</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    <TableRow><TableCell>Gronkh</TableCell><TableCell>Elden Ring</TableCell><TableCell className="tabular text-right">20:14</TableCell></TableRow>
  </TableBody>
</Table>
```
