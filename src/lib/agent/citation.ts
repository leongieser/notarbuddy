import type { OcrWord, RelativeBox, SourceSpan } from "@/db/types";

export interface CitationTarget {
  pageId: string;
  pageIndex: number;
  canonicalText: string;
  words: OcrWord[];
  width: number;
  height: number;
}

export class CitationError extends Error {}

/**
 * Collapses whitespace and column separators so a quote can be matched regardless of how
 * the reconstruction spaced it. Returns the normalised text plus a map back to original
 * offsets, so the span we store still points into the real page text.
 */
function normalise(text: string): { normalised: string; offsets: number[] } {
  const chars: string[] = [];
  const offsets: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[\s|]/.test(char)) {
      pendingSpace = chars.length > 0;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      offsets.push(i);
      pendingSpace = false;
    }
    chars.push(char.toLowerCase());
    offsets.push(i);
  }

  return { normalised: chars.join(""), offsets };
}

/**
 * Finds the agent's quote in the page and returns a verified span.
 *
 * The agent supplies only the text it is citing; the server does the locating. That keeps
 * the guarantee that a value must be backed by text actually present on the page, without
 * making the model count characters — every citation rejection in earlier runs was an
 * off-by-one in hand-counted offsets, never a wrong quote.
 */
export function locateQuote(page: CitationTarget, quote: string): SourceSpan {
  const trimmed = quote.trim();
  if (trimmed.length < 2) {
    throw new CitationError("Das Zitat ist zu kurz, um eindeutig zu sein.");
  }

  const haystack = normalise(page.canonicalText);
  const needle = normalise(trimmed).normalised;

  const hits: number[] = [];
  for (let from = 0; ; ) {
    const at = haystack.normalised.indexOf(needle, from);
    if (at === -1) break;
    hits.push(at);
    from = at + 1;
    if (hits.length > 1) break;
  }

  if (hits.length === 0) {
    throw new CitationError(
      `Das Zitat ${JSON.stringify(trimmed)} steht nicht auf Seite ${page.pageIndex + 1}. Zitiere den Wortlaut so, wie er im Seitentext steht.`,
    );
  }
  if (hits.length > 1) {
    throw new CitationError(
      `Das Zitat ${JSON.stringify(trimmed)} kommt auf Seite ${page.pageIndex + 1} mehrfach vor. Zitiere länger, damit die Fundstelle eindeutig ist.`,
    );
  }

  const start = haystack.offsets[hits[0]];
  const lastIndex = hits[0] + needle.length - 1;
  const end = haystack.offsets[lastIndex] + 1;

  return {
    pageId: page.pageId,
    pageIndex: page.pageIndex,
    start,
    end,
    quote: page.canonicalText.slice(start, end),
    box: boxForRange(page, start, end),
  };
}

/** Union of the boxes of every word overlapping the range, as page fractions. */
function boxForRange(
  page: CitationTarget,
  start: number,
  end: number,
): RelativeBox | null {
  const covered = page.words.filter((w) => w.start < end && w.end > start);
  if (covered.length === 0 || page.width === 0 || page.height === 0)
    return null;

  const x0 = Math.min(...covered.map((w) => w.x0));
  const y0 = Math.min(...covered.map((w) => w.y0));
  const x1 = Math.max(...covered.map((w) => w.x1));
  const y1 = Math.max(...covered.map((w) => w.y1));

  return {
    x: x0 / page.width,
    y: y0 / page.height,
    w: (x1 - x0) / page.width,
    h: (y1 - y0) / page.height,
  };
}

/** Lowest OCR confidence across the cited words — a misread character should drag the field down. */
export function ocrConfidenceForRange(
  page: CitationTarget,
  start: number,
  end: number,
): number {
  const covered = page.words.filter((w) => w.start < end && w.end > start);
  if (covered.length === 0) return 1;
  return Math.min(...covered.map((w) => w.confidence));
}
