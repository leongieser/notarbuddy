import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { OcrError, OcrErrorCode } from "@/db/types";
import {
  buildCanonicalText,
  clusterIntoLines,
  type RawWord,
} from "./canonical";
import { detectLineMarks } from "./marks";

export class OcrFailure extends Error {
  constructor(readonly detail: OcrError) {
    super(detail.message);
  }
}

let client: ImageAnnotatorClient | undefined;

function getClient() {
  if (!client) client = new ImageAnnotatorClient();
  return client;
}

export interface OcrPageResult {
  /** Median word confidence across the page. */
  confidence: number;
  canonicalText: string;
  words: ReturnType<typeof buildCanonicalText>["words"];
  width: number;
  height: number;
}

/**
 * There is deliberately no fallback engine. A Grundbuchauszug that could not be read
 * must surface as unread, never as a lower-quality reading presented as fact.
 */
export async function ocrImage(png: Buffer): Promise<OcrPageResult> {
  let response: Awaited<
    ReturnType<ImageAnnotatorClient["documentTextDetection"]>
  >[0];

  try {
    [response] = await getClient().documentTextDetection({
      image: { content: png },
      imageContext: { languageHints: ["de"] },
    });
  } catch (error) {
    throw new OcrFailure(classify(error));
  }

  const page = response.fullTextAnnotation?.pages?.[0];
  if (!page) {
    throw new OcrFailure({
      code: "UNREADABLE_PAGE",
      message: "Auf dieser Seite wurde kein Text erkannt.",
      retryable: false,
    });
  }

  const raw: RawWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const word of paragraph.words ?? []) {
        const vertices = word.boundingBox?.vertices ?? [];
        if (vertices.length === 0) continue;
        const xs = vertices.map((v) => v.x ?? 0);
        const ys = vertices.map((v) => v.y ?? 0);
        raw.push({
          text: (word.symbols ?? []).map((s) => s.text ?? "").join(""),
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
          confidence: word.confidence ?? 1,
        });
      }
    }
  }

  const width = page.width ?? 0;
  const marks = await detectLineMarks(png, clusterIntoLines(raw), width);
  const { text, words } = buildCanonicalText(raw, width, marks);
  return {
    confidence: meanConfidence(raw),
    canonicalText: text,
    words,
    width,
    height: page.height ?? 0,
  };
}

/**
 * Mean, not median. Median was tried first and proved useless as a quality signal: it read
 * 0.92 on a scan degraded past legibility and 0.98 on a clean render, because half the words
 * on a bad page are still read perfectly. The mean carries the tail that actually matters.
 */
function meanConfidence(words: RawWord[]): number {
  if (words.length === 0) return 0;
  return words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
}

function classify(error: unknown): OcrError {
  const code = (error as { code?: number })?.code;
  const message = (error as { message?: string })?.message ?? String(error);

  const mapped: Partial<Record<number, OcrErrorCode>> = {
    7: "AUTH_FAILED", // PERMISSION_DENIED
    16: "AUTH_FAILED", // UNAUTHENTICATED
    8: "QUOTA_EXCEEDED", // RESOURCE_EXHAUSTED
    4: "NETWORK", // DEADLINE_EXCEEDED
    14: "NETWORK", // UNAVAILABLE
  };

  const resolved: OcrErrorCode = mapped[code ?? -1] ?? "NETWORK";
  return {
    code: resolved,
    message,
    retryable: resolved === "NETWORK" || resolved === "RATE_LIMITED",
  };
}
