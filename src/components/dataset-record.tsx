"use client";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type {
  RecordCell,
  RecordEntry,
  RecordSection,
  UrkundeRecord,
} from "@/lib/urkunde/record";

/** Right-aligned tabular numerals: these columns are read by comparing them down the page. */
const NUMERIC = new Set(["lfdNr", "flur", "flurstueck", "groesse", "betrag"]);
/** Columns carrying sentences rather than tokens; they set the table's width, not the rest. */
const WIDE = new Set([
  "text",
  "grundlageDerEintragung",
  "wirtschaftsartUndLage",
]);

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Deletion is carried by the strikethrough, not by colour: red is reserved for the one
 * thing that needs a person — an unresolved value. A struck row that is also red would
 * make "historical" and "needs attention" look identical.
 */
function StatusMark({
  deleted,
  uncertain,
}: {
  deleted: boolean | null;
  uncertain: boolean;
}) {
  if (deleted === null)
    return <span className="text-destructive text-xs">ungeklärt</span>;
  return (
    <span className="flex flex-col text-xs">
      <span className="text-muted-foreground">
        {deleted ? "gelöscht" : "aktiv"}
      </span>
      {uncertain ? <span className="text-destructive">zu prüfen</span> : null}
    </span>
  );
}

function Value({
  cell,
  struck,
}: {
  cell: RecordCell | undefined;
  struck: boolean;
}) {
  if (!cell || cell.value === null)
    return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <span
        className={[
          struck
            ? "line-through decoration-1 decoration-muted-foreground/70"
            : "",
          cell.status !== "flagged"
            ? ""
            : struck
              ? "text-destructive"
              : "text-destructive underline decoration-destructive/50 decoration-dotted underline-offset-4",
        ].join(" ")}
      >
        {cell.value}
      </span>
      {cell.status === "corrected" ? (
        <span className="ml-2 text-muted-foreground text-xs">korrigiert</span>
      ) : null}
    </>
  );
}

/** The evidence behind one entry: every field with its citation, page and schema path. */
function Evidence({ entry }: { entry: RecordEntry }) {
  return (
    <div className="grid gap-x-8 gap-y-5 bg-muted/50 px-4 py-4 sm:grid-cols-2">
      {entry.cells.map((cell) => (
        <div key={cell.path} className="min-w-0">
          <p className="font-medium text-xs">{cell.label}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {cell.path}
          </p>
          <p className="mt-1.5 text-sm">
            {cell.value ?? (
              <span className="text-muted-foreground italic">
                nicht bestimmt
              </span>
            )}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {cell.span ? `Seite ${cell.span.pageIndex + 1}` : "ohne Fundstelle"}
            {cell.confidence !== null ? (
              <span className="tabular-nums">
                {" · "}
                Konfidenz {cell.confidence.toFixed(2)}
              </span>
            ) : null}
          </p>
          {cell.span ? (
            <p className="mt-1.5 border-border border-l pl-2.5 font-mono text-[11px] text-muted-foreground">
              {cell.span.quote}
            </p>
          ) : null}
          {cell.note ? (
            <p className="mt-1.5 text-destructive text-xs">
              <span className="text-muted-foreground">Hinweis: </span>
              {cell.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  section,
  columns,
  open,
  onToggle,
}: {
  entry: RecordEntry;
  section: RecordSection;
  columns: typeof section.columns;
  open: boolean;
  onToggle: () => void;
}) {
  const struck = entry.deleted === true;
  const byKey = new Map(entry.cells.map((cell) => [cell.key, cell]));

  return (
    <>
      <tr className={struck ? "text-muted-foreground" : ""}>
        {columns.map((column) =>
          column.key === "status" ? (
            <td key={column.key} className="px-3 py-3 align-top">
              <StatusMark
                deleted={entry.deleted}
                uncertain={byKey.get("status")?.status === "flagged"}
              />
            </td>
          ) : (
            <td
              key={column.key}
              className={`px-3 py-3 align-top ${
                NUMERIC.has(column.key) ? "text-right tabular-nums" : ""
              }`}
            >
              <Value cell={byKey.get(column.key)} struck={struck} />
            </td>
          ),
        )}
        <td className="py-3 pr-3 pl-1 text-right align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs hover:text-foreground"
          >
            Belege
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
            <span className="sr-only">
              {` für ${section.label}, Eintrag ${entry.index + 1}`}
            </span>
          </button>
        </td>
      </tr>
      <AnimatePresence initial={false}>
        {open ? (
          <tr>
            <td colSpan={columns.length + 1} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <Evidence entry={entry} />
              </motion.div>
            </td>
          </tr>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Section({ section }: { section: RecordSection }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const wide = section.columns.some((c) => WIDE.has(c.key));

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium text-sm">{section.label}</h3>
        <p className="text-muted-foreground text-xs">
          {plural(section.entries.length, "Eintrag", "Einträge")}
          {section.deletedCount > 0
            ? ` · ${section.deletedCount} gelöscht`
            : ""}
        </p>
      </div>
      <div className="relative min-w-0 overflow-x-auto rounded border">
        <table
          className={`w-full text-sm ${wide ? "min-w-[52rem]" : "min-w-[34rem]"}`}
        >
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
              {section.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 font-medium ${
                    NUMERIC.has(column.key) ? "text-right" : "text-left"
                  }`}
                >
                  {column.label}
                </th>
              ))}
              <th scope="col" className="w-0 py-2 pr-3">
                <span className="sr-only">Belege</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {section.entries.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                section={section}
                columns={section.columns}
                open={openKey === entry.key}
                onToggle={() =>
                  setOpenKey((k) => (k === entry.key ? null : entry.key))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The extracted dataset in the shape of the document it came from: the Aufschrift as a
 * caption, then one row per Eintragung under the section it belongs to. Confidence and
 * citations sit one click below each entry rather than in columns nobody scans.
 */
export function DatasetRecord({ record }: { record: UrkundeRecord }) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {record.header.map((cell) => (
            <div key={cell.path}>
              <dt className="text-muted-foreground text-xs uppercase tracking-wider">
                {cell.label}
              </dt>
              <dd className="mt-1 text-base">
                <Value cell={cell} struck={false} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t pt-3 text-muted-foreground text-xs">
          {plural(record.total, "Feld", "Felder")}
          {record.flagged > 0 ? (
            <span className="text-destructive">
              {` · ${record.flagged} zu prüfen`}
            </span>
          ) : null}
          {record.deletedEntries > 0
            ? ` · ${plural(record.deletedEntries, "gelöschter Eintrag", "gelöschte Einträge")}`
            : ""}
        </p>
      </div>

      {record.sections.map((section) => (
        <Section key={section.key} section={section} />
      ))}

      {record.extra.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">Nicht im Schema</h3>
          <ul className="divide-y rounded border">
            {record.extra.map((cell) => (
              <li key={cell.path} className="flex gap-4 px-3 py-2 text-sm">
                <span className="font-mono text-muted-foreground text-xs">
                  {cell.path}
                </span>
                <span>{cell.value ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
