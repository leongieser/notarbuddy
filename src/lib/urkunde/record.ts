import type { FieldStatus, SourceSpan } from "@/db/types";
import {
  type FieldDefinition,
  LIST_GROUPS,
  parseFieldPath,
  SINGLE_FIELDS,
} from "./schema";

export interface RecordInput {
  id: string;
  path: string;
  value: string | null;
  confidence: number | null;
  status: FieldStatus;
  critical: boolean;
  note: string | null;
  sourceSpans: SourceSpan[] | null;
}

export interface RecordCell extends RecordInput {
  key: string;
  label: string;
  span: SourceSpan | null;
}

export interface RecordEntry {
  key: string;
  index: number;
  cells: RecordCell[];
  /** null means the agent never settled the entry's Aktiv/Gelöscht state. */
  deleted: boolean | null;
  flagged: number;
}

export interface RecordSection {
  key: string;
  label: string;
  critical: boolean;
  columns: FieldDefinition[];
  entries: RecordEntry[];
  deletedCount: number;
}

export interface UrkundeRecord {
  header: RecordCell[];
  sections: RecordSection[];
  /** Paths the schema no longer defines. Empty in practice; rendered rather than dropped. */
  extra: RecordCell[];
  total: number;
  flagged: number;
  deletedEntries: number;
}

function readDeleted(cell: RecordCell | undefined): boolean | null {
  const value = cell?.value?.trim().toLowerCase();
  if (!value) return null;
  if (value === "geloescht" || value === "gelöscht") return true;
  if (value === "aktiv") return false;
  return null;
}

/**
 * Regroups the flat field list into the Grundbuch's own structure: one entry per
 * Eigentümer or Eintragung, in the schema's column order. The agent records paths, but a
 * notary reads sections — a list of `abteilung3[1].glaeubiger` rows is neither.
 */
export function buildRecord(input: RecordInput[]): UrkundeRecord {
  const cells = new Map<string, RecordCell>();
  const extra: RecordCell[] = [];

  for (const field of input) {
    const parsed = parseFieldPath(field.path);
    if (!parsed) {
      extra.push({
        ...field,
        key: field.path,
        label: field.path,
        span: field.sourceSpans?.[0] ?? null,
      });
      continue;
    }
    cells.set(field.path, {
      ...field,
      key: parsed.index === null ? field.path : parsed.field,
      label:
        parsed.index === null
          ? parsed.label
          : (LIST_GROUPS.find((g) => g.key === parsed.group)?.fields.find(
              (f) => f.key === parsed.field,
            )?.label ?? parsed.field),
      span: field.sourceSpans?.[0] ?? null,
    });
  }

  const header = SINGLE_FIELDS.map((f) => cells.get(f.key)).filter(
    (c): c is RecordCell => c !== undefined,
  );

  const sections: RecordSection[] = [];
  for (const group of LIST_GROUPS) {
    const indices = new Set<number>();
    for (const path of cells.keys()) {
      const parsed = parseFieldPath(path);
      if (parsed?.group === group.key && parsed.index !== null)
        indices.add(parsed.index);
    }
    if (indices.size === 0) continue;

    const entries: RecordEntry[] = [...indices]
      .sort((a, b) => a - b)
      .map((index) => {
        const entryCells = group.fields
          .map((f) => cells.get(`${group.key}[${index}].${f.key}`))
          .filter((c): c is RecordCell => c !== undefined);
        return {
          key: `${group.key}[${index}]`,
          index,
          cells: entryCells,
          deleted: readDeleted(entryCells.find((c) => c.key === "status")),
          flagged: entryCells.filter((c) => c.status === "flagged").length,
        };
      });

    sections.push({
      key: group.key,
      label: group.label,
      critical: group.critical,
      columns: group.fields,
      entries,
      deletedCount: entries.filter((e) => e.deleted === true).length,
    });
  }

  const all = [...cells.values(), ...extra];
  return {
    header,
    sections,
    extra,
    total: all.length,
    flagged: all.filter((c) => c.status === "flagged").length,
    deletedEntries: sections.reduce((sum, s) => sum + s.deletedCount, 0),
  };
}
