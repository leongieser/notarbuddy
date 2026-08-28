import { desc, eq } from "drizzle-orm";
import { db, documents, drafts } from "@/db";
import { renderDraftPdf } from "@/lib/urkunde/pdf";

/** `Muster.pdf` → `Muster-urkundenentwurf.pdf`, and never a header-injecting filename. */
function filenameFor(documentName: string): string {
  const stem = documentName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "-");
  return `${stem || "grundbuchauszug"}-urkundenentwurf.pdf`;
}

/**
 * Serves the stored draft as a PDF.
 *
 * It renders the draft row, not the current field values: the draft is a snapshot taken
 * when the gate opened, and re-deriving it here would let a printout drift away from the
 * text the audit log records. No stored draft means no PDF — the gate is upstream of this.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!doc) return new Response("Dokument nicht gefunden.", { status: 404 });

  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.documentId, id))
    .orderBy(desc(drafts.createdAt))
    .limit(1);
  if (!draft)
    return new Response(
      "Für dieses Dokument wurde noch kein Entwurf freigegeben.",
      { status: 404 },
    );

  const bytes = await renderDraftPdf({
    content: draft.content,
    documentName: doc.name,
    draftId: draft.id,
    createdAt: draft.createdAt,
  });

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filenameFor(doc.name)}"`,
      "cache-control": "no-store",
    },
  });
}
