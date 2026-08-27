import { db, documents, pages } from "@/db";
import { rasterizePdf } from "./rasterize";
import { storePageImage } from "./storage";

export class IngestError extends Error {}

export interface IngestResult {
  documentId: string;
  pageCount: number;
}

/** Browsers report an empty `type` for some files, so the extension is a real fallback, not a nicety. */
export function isPdf(mime: string, name: string): boolean {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

export async function ingestPdf(name: string, data: Buffer) {
  const rasterized = await rasterizePdf(data);
  if (rasterized.length === 0)
    throw new IngestError("PDF enthält keine Seiten.");

  const [doc] = await db
    .insert(documents)
    .values({ name, sourceType: "pdf" })
    .returning();

  for (const [index, page] of rasterized.entries()) {
    const imagePath = await storePageImage(doc.id, index, page.png);
    await db.insert(pages).values({
      documentId: doc.id,
      pageIndex: index,
      imagePath,
      width: page.width,
      height: page.height,
    });
  }

  return {
    documentId: doc.id,
    pageCount: rasterized.length,
  } satisfies IngestResult;
}
