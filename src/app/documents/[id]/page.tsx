import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageReader } from "@/components/page-reader";
import { Badge } from "@/components/ui/badge";
import { db, documents, pages } from "@/db";

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

  const docPages = await db
    .select()
    .from(pages)
    .where(eq(pages.documentId, id))
    .orderBy(asc(pages.pageIndex));

  const unread = docPages.filter((p) => p.ocrStatus !== "ok").length;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Dokumente
        </Link>
        <h1 className="font-semibold text-2xl">{doc.name}</h1>
        <p className="text-muted-foreground text-sm">
          {docPages.length} Seiten ·{" "}
          {unread === 0
            ? "vollständig gelesen"
            : `${unread} noch nicht gelesen`}
        </p>
      </header>

      {docPages.map((page) => (
        <section key={page.id} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-sm">Seite {page.pageIndex + 1}</h2>
            <Badge variant={page.ocrStatus === "ok" ? "secondary" : "outline"}>
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
        </section>
      ))}
    </main>
  );
}
