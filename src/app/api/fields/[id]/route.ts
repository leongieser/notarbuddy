import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, events, fields } from "@/db";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({
    action: z.literal("correct"),
    value: z.string().min(1),
    reason: z.string().optional(),
  }),
  // "The document does not state this" is an answer, not an open question. A Grundbuch
  // records a Miteigentumsanteil only for co-ownership, so a sole owner has none — and
  // without this a critical field with no value could never be resolved, leaving the draft
  // blocked behind a value the reviewer would have to invent.
  z.object({ action: z.literal("absent"), reason: z.string().optional() }),
]);

/**
 * Records a human decision on one field.
 *
 * The event is written before the field is updated. If the update then fails, the audit log
 * still shows the attempt — the opposite order would let a decision disappear entirely.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Erwartet: { action: 'confirm' } oder { action: 'correct', value }",
      },
      { status: 400 },
    );
  }

  const [field] = await db
    .select()
    .from(fields)
    .where(eq(fields.id, id))
    .limit(1);
  if (!field)
    return Response.json({ error: "Feld nicht gefunden." }, { status: 404 });

  const decision = parsed.data;
  const correcting = decision.action === "correct";
  const absent = decision.action === "absent";
  const newValue = correcting ? decision.value : absent ? null : field.value;
  const reason = correcting
    ? (decision.reason ?? "manuell korrigiert")
    : absent
      ? (decision.reason ?? "im Auszug nicht angegeben")
      : "manuell bestätigt";

  await db.insert(events).values({
    documentId: field.documentId,
    fieldPath: field.path,
    actor: "user",
    action: correcting ? "corrected" : "confirmed",
    oldValue: field.value,
    newValue,
    evidence: {
      spans: field.sourceSpans ?? undefined,
      confidence: field.confidence ?? undefined,
      reason,
    },
  });

  const [updated] = await db
    .update(fields)
    .set({
      value: newValue,
      status: correcting ? "corrected" : "confirmed",
      note: correcting || absent ? (decision.reason ?? null) : field.note,
      updatedAt: new Date(),
    })
    .where(eq(fields.id, id))
    .returning();

  return Response.json(updated);
}
