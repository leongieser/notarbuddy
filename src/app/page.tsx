import { countDistinct, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { DeleteDocument } from "@/components/delete-document";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadForm } from "@/components/upload-form";
import { db, documents, fields, pages } from "@/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  uploaded: "hochgeladen",
  extracting: "läuft",
  review: "zur Prüfung",
  failed: "fehlgeschlagen",
} as const;

const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});

export default async function Home() {
  const rows = await db
    .select({
      id: documents.id,
      name: documents.name,
      status: documents.status,
      createdAt: documents.createdAt,
      // Joining both children multiplies rows, so every count has to be distinct.
      pageCount: countDistinct(pages.id),
      fieldCount: countDistinct(fields.id),
      flaggedCount: sql<number>`count(distinct ${fields.id}) filter (where ${fields.status} = 'flagged')`,
    })
    .from(documents)
    .leftJoin(pages, eq(pages.documentId, documents.id))
    .leftJoin(fields, eq(fields.documentId, documents.id))
    .groupBy(documents.id)
    .orderBy(desc(documents.createdAt));

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-8 p-8">
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

      <section className="flex min-w-0 flex-col gap-4">
        <h2 className="font-medium text-lg">Dokumente</h2>
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Noch keine Dokumente</EmptyTitle>
              <EmptyDescription>
                Lade oben einen Grundbuchauszug hoch.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded border">
            {/* min-w-0: a flex item does not shrink below its content by default, so
                without it the table pushes the whole page into a horizontal scroll
                instead of scrolling inside this container. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dokument</TableHead>
                  <TableHead className="w-24 text-right">Seiten</TableHead>
                  <TableHead className="w-32 text-right">Felder</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-40">Hochgeladen</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="hover:underline"
                      >
                        {doc.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {doc.pageCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {doc.fieldCount > 0 ? (
                        <>
                          {doc.fieldCount}
                          {doc.flaggedCount > 0 ? (
                            <span className="ml-2 text-destructive">
                              {doc.flaggedCount} markiert
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          doc.status === "failed" ? "destructive" : "secondary"
                        }
                      >
                        {STATUS_LABEL[doc.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {dateFormat.format(doc.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/documents/${doc.id}`} />}
                        >
                          Öffnen
                        </Button>
                        <DeleteDocument documentId={doc.id} name={doc.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </main>
  );
}
