import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, pages } from "@/db";
import { resolvePageImage } from "@/lib/ingest/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);

  if (!page?.imagePath) return new Response("not found", { status: 404 });

  const bytes = await readFile(resolvePageImage(page.imagePath));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000",
    },
  });
}
