import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, documents } from "@/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [deleted] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning();
  if (!deleted) return new Response("not found", { status: 404 });

  // Pages, runs, fields and events go with the document via ON DELETE CASCADE;
  // the stored page images do not.
  await rm(path.join(process.cwd(), "data", "uploads", id), {
    recursive: true,
    force: true,
  });

  return new Response(null, { status: 204 });
}
