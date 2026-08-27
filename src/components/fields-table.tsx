import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Field } from "@/db";

const STATUS_VARIANT = {
  extracted: "secondary",
  flagged: "destructive",
  confirmed: "default",
  corrected: "default",
} as const;

export function FieldsTable({ fields }: { fields: Field[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[22rem]">Feld</TableHead>
          <TableHead>Wert</TableHead>
          <TableHead className="w-20">Konfidenz</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead>Beleg</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((field) => (
          <TableRow key={field.id}>
            <TableCell className="font-mono text-xs">
              {field.path}
              {field.critical ? (
                <Badge variant="outline" className="ml-2">
                  kritisch
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className="text-sm">
              {field.value ?? <span className="text-muted-foreground">—</span>}
              {field.note ? (
                <p className="mt-1 text-muted-foreground text-xs">
                  {field.note}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="text-sm tabular-nums">
              {field.confidence === null ? "—" : field.confidence.toFixed(2)}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[field.status]}>
                {field.status}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {field.sourceSpans?.[0] ? (
                <>
                  <span className="font-medium">
                    S. {field.sourceSpans[0].pageIndex + 1}
                  </span>{" "}
                  <span className="font-mono">
                    „{field.sourceSpans[0].quote}"
                  </span>
                </>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
