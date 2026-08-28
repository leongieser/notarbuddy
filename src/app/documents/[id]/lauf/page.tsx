import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DatasetRecord } from "@/components/dataset-record";
import { ExtractionPanel } from "@/components/extraction-panel";
import { PageReader } from "@/components/page-reader";
import { RunTabs } from "@/components/run-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db, documents, fields, pages, runs } from "@/db";
import { buildRecord } from "@/lib/urkunde/record";

export const dynamic = "force-dynamic";

/**
 * The technical view: what the agent did, what it cost, and the raw material it worked
 * from. Split off the review screen deliberately — a clerk deciding whether a value is
 * correct should not have to scroll past tool-call JSON to reach their task, and an
 * engineer checking the loop should not have to hunt for it among review controls.
 */
export default async function RunPage({
  params,
}: PageProps<"/documents/[id]/lauf">) {
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

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-3">
        <Link
          href={`/documents/${id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Prüfung
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold text-2xl">Agentenlauf</h1>
          <Badge variant="secondary">{doc.name}</Badge>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/documents/${id}`} />}
            >
              Zur Prüfung
            </Button>
          </div>
        </div>
      </header>

      <section className="flex min-w-0 flex-col gap-4">
        <h2 className="font-medium text-lg">Extraktion</h2>
        <ExtractionPanel documentId={id} initialRunId={latestRun?.id ?? null} />
      </section>

      <RunTabs
        pageCount={docPages.length}
        fieldCount={docFields.length}
        dataset={
          docFields.length > 0 ? (
            <DatasetRecord record={buildRecord(docFields)} />
          ) : (
            <p className="rounded border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
              Noch kein Feld erfasst. Der Datensatz füllt sich, sobald der Agent
              zu lesen beginnt.
            </p>
          )
        }
        pages={
          <div className="flex min-w-0 flex-col gap-6">
            {docPages.map((page) => (
              <div key={page.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">
                    Seite {page.pageIndex + 1}
                  </h3>
                  <Badge
                    variant={page.ocrStatus === "ok" ? "secondary" : "outline"}
                  >
                    {page.ocrStatus === "ok"
                      ? "gelesen"
                      : page.ocrStatus === "failed"
                        ? "Fehler"
                        : "offen"}
                  </Badge>
                  {page.ocrConfidence !== null ? (
                    <span className="text-muted-foreground text-xs">
                      Lesequalität {page.ocrConfidence.toFixed(2)}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* biome-ignore lint/performance/noImgElement: served from a route handler, not the public dir */}
                  <img
                    src={`/api/pages/${page.id}/image`}
                    alt={`Seite ${page.pageIndex + 1} des Grundbuchauszugs`}
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
          </div>
        }
      />
    </main>
  );
}
