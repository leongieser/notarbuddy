import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditLog } from "@/components/audit-log";
import { DeleteDocument } from "@/components/delete-document";
import { ReleasePanel } from "@/components/release-panel";
import { type ReviewField, ReviewPanel } from "@/components/review-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db, documents, drafts, events, fields, pages } from "@/db";
import { boxesForValue, weakestWord } from "@/lib/agent/citation";
import { detectSection } from "@/lib/ocr/canonical";
import { evaluateGate } from "@/lib/urkunde/gate";
import {
  fieldLabelForPath,
  groupForPath,
  labelForPath,
} from "@/lib/urkunde/schema";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  uploaded: "hochgeladen",
  extracting: "läuft",
  review: "zur Prüfung",
  failed: "fehlgeschlagen",
} as const;

export default async function DocumentPage({
  params,
}: PageProps<"/documents/[id]">) {
  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!doc) notFound();

  const [docPages, docFields, docEvents, [latestDraft], gate] =
    await Promise.all([
      db
        .select()
        .from(pages)
        .where(eq(pages.documentId, id))
        .orderBy(asc(pages.pageIndex)),
      db
        .select()
        .from(fields)
        .where(eq(fields.documentId, id))
        .orderBy(asc(fields.path)),
      db
        .select()
        .from(events)
        .where(eq(events.documentId, id))
        .orderBy(desc(events.createdAt))
        .limit(80),
      db
        .select()
        .from(drafts)
        .where(eq(drafts.documentId, id))
        .orderBy(desc(drafts.createdAt))
        .limit(1),
      evaluateGate(id),
    ]);

  const pageById = new Map(docPages.map((p) => [p.id, p]));

  const toReviewField = (field: (typeof docFields)[number]): ReviewField => {
    const spans = field.sourceSpans ?? [];
    const span = spans[0];
    const source = span ? pageById.get(span.pageId) : undefined;
    const target =
      source?.canonicalText && source.words
        ? {
            pageId: source.id,
            pageIndex: source.pageIndex,
            canonicalText: source.canonicalText,
            words: source.words,
            width: source.width,
            height: source.height,
          }
        : null;
    const boxes = target
      ? boxesForValue(target, spans, field.value)
      : (span?.boxes ?? []);
    const weakest = target ? weakestWord(target, spans, field.value) : null;
    return {
      id: field.id,
      path: field.path,
      label: fieldLabelForPath(field.path),
      group: groupForPath(field.path),
      value: field.value,
      status: field.status,
      confidence: field.confidence,
      note: field.note,
      critical: field.critical,
      quote: spans.map((s) => s.quote).join(" … "),
      boxes,
      weakest,
      pageId: span?.pageId ?? "",
      pageIndex: span?.pageIndex ?? 0,
    };
  };

  const labelFor = Object.fromEntries(
    docFields.map((f) => [f.path, labelForPath(f.path)]),
  );
  const flagged = docFields.filter((f) => f.status === "flagged").length;
  const unread = docPages.filter((p) => p.ocrStatus !== "ok").length;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Dokumente
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold text-2xl">{doc.name}</h1>
          <Badge
            variant={doc.status === "failed" ? "destructive" : "secondary"}
          >
            {STATUS_LABEL[doc.status]}
          </Badge>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/documents/${doc.id}/lauf`} />}
            >
              Agentenlauf
            </Button>
            <DeleteDocument documentId={doc.id} name={doc.name} />
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {docPages.length} Seiten ·{" "}
          {unread === 0
            ? "vollständig gelesen"
            : `${unread} noch nicht gelesen`}{" "}
          · {docFields.length} Felder
          {flagged > 0 ? (
            <span className="text-destructive">
              {" "}
              · {flagged} zur Prüfung markiert
            </span>
          ) : null}
        </p>
      </header>

      {docFields.length === 0 ? (
        <section className="rounded border border-dashed p-6">
          <p className="text-sm">
            Für dieses Dokument wurde noch kein Datensatz erfasst.
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            Starte die Extraktion unter{" "}
            <Link href={`/documents/${doc.id}/lauf`} className="underline">
              Agentenlauf
            </Link>
            .
          </p>
        </section>
      ) : (
        <>
          {/* Freigabe and Prüfung share one section on purpose: a sticky element only
              travels inside its own parent, so the gate needs a box as tall as the list
              it is meant to follow. */}
          <section className="flex min-w-0 flex-col gap-4">
            <h2 className="font-medium text-lg">Freigabe</h2>
            <ReleasePanel
              documentId={doc.id}
              gate={gate}
              draft={latestDraft ?? null}
              labelFor={labelFor}
            />

            <h2 className="mt-6 font-medium text-lg">Prüfung</h2>
            <ReviewPanel
              fields={docFields.map(toReviewField)}
              pages={docPages.map((p) => ({
                id: p.id,
                pageIndex: p.pageIndex,
                width: p.width,
                height: p.height,
                section: detectSection(p.canonicalText),
              }))}
            />
          </section>
        </>
      )}

      <section className="flex min-w-0 flex-col gap-4">
        <h2 className="font-medium text-lg">Audit-Log</h2>
        <p className="text-muted-foreground text-sm">
          Jede Änderung an einem Feld, mit Zeitpunkt, Urheber und Begründung.
        </p>
        <div className="rounded border p-4">
          <AuditLog events={docEvents} labelFor={labelFor} />
        </div>
      </section>
    </main>
  );
}
