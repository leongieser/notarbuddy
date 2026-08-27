import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, pages } from "@/db";
import type { OcrError } from "@/db/types";
import { resolvePageImage } from "@/lib/ingest/storage";
import { OcrFailure, ocrImage } from "./vision";

export { buildCanonicalText } from "./canonical";
export { OcrFailure } from "./vision";

/**
 * Reads one page and persists the result. Failure is recorded on the page rather than
 * thrown away, so the UI, the draft gate and the agent all see the same unread state.
 */
export async function ocrPage(pageId: string) {
  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!page) throw new Error(`page ${pageId} not found`);

  let png: Buffer;
  try {
    png = await readFile(resolvePageImage(page.imagePath));
  } catch {
    // Not retryable: the stored page image is gone, and calling Vision again
    // cannot bring it back.
    return failPage(pageId, {
      code: "IMAGE_MISSING",
      message: "Das gespeicherte Seitenbild wurde nicht gefunden.",
      retryable: false,
    });
  }

  try {
    const result = await ocrImage(png);
    const [updated] = await db
      .update(pages)
      .set({
        ocrStatus: "ok",
        ocrError: null,
        canonicalText: result.canonicalText,
        words: result.words,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, pageId))
      .returning();
    return updated;
  } catch (error) {
    if (error instanceof OcrFailure) return failPage(pageId, error.detail);

    console.error("ocr failed", { pageId, error });
    return failPage(pageId, {
      code: "NETWORK",
      message: "Die Texterkennung ist fehlgeschlagen.",
      retryable: true,
    });
  }
}

/** Records the failure on the page before rethrowing, so unread state is never lost. */
async function failPage(pageId: string, detail: OcrError): Promise<never> {
  await db
    .update(pages)
    .set({ ocrStatus: "failed", ocrError: detail, updatedAt: new Date() })
    .where(eq(pages.id, pageId));
  throw new OcrFailure(detail);
}
