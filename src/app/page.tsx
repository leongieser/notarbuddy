import { desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { UploadForm } from "@/components/upload-form";
import { db, documents, pages } from "@/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const docs = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.createdAt));
  const allPages = await db.select().from(pages).orderBy(pages.pageIndex);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl">NotaryBuddy</h1>
        <p className="text-muted-foreground text-sm">
          Grundbuchauszug einlesen, prüfen und freigeben.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Neuer Auszug</CardTitle>
          <CardDescription>
            Die Seiten werden gespeichert, aber noch nicht gelesen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="font-medium text-lg">Dokumente</h2>
        {docs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Noch keine Dokumente</EmptyTitle>
              <EmptyDescription>
                Lade oben einen Grundbuchauszug hoch.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          docs.map((doc) => {
            const docPages = allPages.filter((p) => p.documentId === doc.id);
            return (
              <Card key={doc.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {doc.name}
                    <Badge variant="secondary">{doc.sourceType}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {docPages.length}{" "}
                    {docPages.length === 1 ? "Seite" : "Seiten"} · {doc.status}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {docPages.map((page) => (
                      // biome-ignore lint/performance/noImgElement: page images are served from a route handler, not the public dir
                      <img
                        key={page.id}
                        src={`/api/pages/${page.id}/image`}
                        alt={`Seite ${page.pageIndex + 1}`}
                        className="h-40 w-auto rounded border bg-white object-contain"
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </main>
  );
}
