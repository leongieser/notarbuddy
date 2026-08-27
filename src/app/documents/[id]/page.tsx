import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteDocument } from "@/components/delete-document";
import { ExtractionPanel } from "@/components/extraction-panel";
import { FieldsTable } from "@/components/fields-table";
import { PageReader } from "@/components/page-reader";
import { Badge } from "@/components/ui/badge";
import { db, documents, fields, pages, runs } from "@/db";

export const dynamic = "force-dynamic";

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

  const [docPages, docFields, [latestRun]] = await Promise.all([
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
      .from(runs)
      .where(eq(runs.documentId, id))
      .orderBy(desc(runs.createdAt))
      .limit(1),
  ]);

  const unread = docPages.filter((p) => p.ocrStatus !== "ok").length;
  const flagged = docFields.filter((f) => f.status === "flagged").length;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Dokumente
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold text-2xl">{doc.name}</h1>
          <Badge variant="secondary">{doc.status}</Badge>
          <div className="ml-auto">
            <DeleteDocument documentId={doc.id} name={doc.name} />
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {docPages.length} Seiten ·{" "}
          {unread === 0
            ? "vollständig gelesen"
            : `${unread} noch nicht gelesen`}{" "}
          · {docFields.length} Felder
          {flagged > 0 ? ` · ${flagged} zur Prüfung markiert` : ""}
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-medium text-lg">Agent</h2>
        <ExtractionPanel
          documentId={doc.id}
          initialRunId={latestRun?.id ?? null}
        />
      </section>

      {docFields.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-medium text-lg">Datensatz</h2>
          <div className="overflow-x-auto rounded border">
            <FieldsTable fields={docFields} />
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-6">
        <h2 className="font-medium text-lg">Seiten</h2>
        {docPages.map((page) => (
          <div key={page.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">
                Seite {page.pageIndex + 1}
              </h3>
              <Badge
                variant={page.ocrStatus === "ok" ? "secondary" : "outline"}
              >
                {page.ocrStatus}
              </Badge>
              {page.words ? (
                <span className="text-muted-foreground text-xs">
                  {page.words.length} Wörter
                </span>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {/* biome-ignore lint/performance/noImgElement: served from a route handler, not the public dir */}
              <img
                src={`/api/pages/${page.id}/image`}
                alt={`Seite ${page.pageIndex + 1}`}
                className="w-full rounded border bg-white object-contain"
              />
              <PageReader
                pageId={page.id}
                ocrStatus={page.ocrStatus}
                ocrError={page.ocrError}
                canonicalText={page.canonicalText}
              />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
