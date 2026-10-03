import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@replaymark/ds';

const rows = [
  ['Gronkh', 'Elden Ring', '20:14', 'Zugestellt'],
  ['Papaplatte', 'Just Chatting', '19:02', 'Zugestellt'],
  ['Maxim', 'Minecraft', '18:47', 'Fehlgeschlagen'],
];

export const History = () => (
  <div className="surface p-2">
    <Table>
      <TableCaption>Benachrichtigungen der letzten 7 Tage</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Streamer</TableHead>
          <TableHead>Spiel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Zeit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([s, g, t, st]) => (
          <TableRow key={s}>
            <TableCell className="font-medium">{s}</TableCell>
            <TableCell>{g}</TableCell>
            <TableCell>
              <Badge variant={st === 'Zugestellt' ? 'outline' : 'destructive'}>
                {st}
              </Badge>
            </TableCell>
            <TableCell className="tabular text-right">{t}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);
