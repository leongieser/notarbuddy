import { desc } from "drizzle-orm";
import { db, documents } from "@/db";
import { IngestError, ingestPdf, isPdf } from "@/lib/ingest";

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const rows = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.createdAt));
  return Response.json(rows);
}

export async function POST(request: Request) {
  // Throws outright on a non-multipart body, which would otherwise surface as a bare 500.
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Keine Datei übermittelt." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Datei ist größer als ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  if (!isPdf(file.type, file.name)) {
    return Response.json(
      { error: "Nur PDF-Dateien werden unterstützt." },
      { status: 415 },
    );
  }

  const data = Buffer.from(await file.arrayBuffer());
  try {
    return Response.json(await ingestPdf(file.name, data), {
      status: 201,
    });
  } catch (error) {
    // An unreadable upload must say why; a bare 500 leaves the UI guessing.
    const message =
      error instanceof IngestError
        ? error.message
        : "PDF konnte nicht gelesen werden.";
    console.error("ingest failed", { name: file.name, type: file.type, error });
    return Response.json({ error: message }, { status: 422 });
  }
}
