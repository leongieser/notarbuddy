import { desc, eq } from "drizzle-orm";
import { db, documents, drafts, events, fields } from "@/db";
import { renderDraft } from "@/lib/urkunde/draft";
import { evaluateGate } from "@/lib/urkunde/gate";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [latest] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.documentId, id))
    .orderBy(desc(drafts.createdAt))
    .limit(1);

  const gate = await evaluateGate(id);
  return Response.json({ gate, draft: latest ?? null });
}

/**
 * Generates the Urkunden-Entwurf — but only once every critical field carries a human
 * decision. The check runs here, in the endpoint, not in the client: a direct call that
 * bypasses the interface entirely must hit exactly the same refusal.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!doc)
    return Response.json(
      { error: "Dokument nicht gefunden." },
      { status: 404 },
    );

  const gate = await evaluateGate(id);
  if (!gate.open) {
    return Response.json(
      {
        error:
          "Freigabe verweigert: nicht alle kritischen Felder sind bestätigt.",
        gate,
      },
      { status: 403 },
    );
  }

  const all = await db.select().from(fields).where(eq(fields.documentId, id));
  const { content, snapshot } = renderDraft(all, doc.name);

  const [draft] = await db
    .insert(drafts)
    .values({ documentId: id, content, snapshot })
    .returning();

  await db.insert(events).values({
    documentId: id,
    actor: "user",
    action: "draft_generated",
    newValue: draft.id,
    evidence: {
      reason: `Entwurf erzeugt aus ${gate.criticalResolved} bestätigten kritischen Feldern`,
    },
  });

  return Response.json({ gate, draft }, { status: 201 });
}
