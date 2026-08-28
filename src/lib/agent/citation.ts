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
    boxes: boxesForRange(page, start, end),
  };
}

/** Union of the boxes of every word overlapping the range, as page fractions. */
function boxesForRange(
  page: CitationTarget,
  start: number,
  end: number,
): RelativeBox[] {
  const covered = page.words.filter((w) => w.start < end && w.end > start);
  if (covered.length === 0 || page.width === 0 || page.height === 0) return [];

  const lines: OcrWord[][] = [];
  for (const word of [...covered].sort((a, b) => a.start - b.start)) {
    const centre = (word.y0 + word.y1) / 2;
    const line = lines.find((l) => {
      const top = Math.min(...l.map((w) => w.y0));
      const bottom = Math.max(...l.map((w) => w.y1));
      return centre >= top && centre <= bottom;
    });
    if (line) line.push(word);
    else lines.push([word]);
  }

  return lines.map((line) => {
    const x0 = Math.min(...line.map((w) => w.x0));
    const y0 = Math.min(...line.map((w) => w.y0));
    const x1 = Math.max(...line.map((w) => w.x1));
    const y1 = Math.max(...line.map((w) => w.y1));
    return {
      x: x0 / page.width,
      y: y0 / page.height,
      w: (x1 - x0) / page.width,
      h: (y1 - y0) / page.height,
    };
  });
}

interface Range {
  start: number;
  end: number;
}

/**
 * The parts of a citation that carry the value itself, or null when it is not in the
 * quoted text verbatim.
 *
 * The agent quotes whole table rows, because a shorter quote is often ambiguous on a page
 * where the same word appears in several columns. That makes the stored span correct but
 * blunt — everything derived from it then describes the row rather than the value.
 */
function rangesForValue(
  page: CitationTarget,
  spans: SourceSpan[],
  value: string | null,
): Range[] | null {
  if (!value || value.trim().length === 0) return null;
  const needle = normalise(value).normalised;
  if (needle.length === 0) return null;

  const ranges: Range[] = [];
  for (const span of spans.filter((s) => s.pageId === page.pageId)) {
    const slice = normalise(page.canonicalText.slice(span.start, span.end));
    const at = slice.normalised.indexOf(needle);
    if (at === -1) continue;
    // A short value like "1" repeats across the columns of one row. Narrowing to the first
    // hit would point at the wrong cell, so an ambiguous value keeps the full citation.
    if (slice.normalised.indexOf(needle, at + 1) !== -1) continue;
    ranges.push({
      start: span.start + slice.offsets[at],
      end: span.start + slice.offsets[at + needle.length - 1] + 1,
    });
  }
  return ranges.length > 0 ? ranges : null;
}

function fullRanges(page: CitationTarget, spans: SourceSpan[]): Range[] {
  return spans
    .filter((s) => s.pageId === page.pageId)
    .map((s) => ({ start: s.start, end: s.end }));
}

/**
 * Boxes bounding the value rather than the whole quoted row.
 *
 * The stored span stays as the agent asserted it — that is what the audit log has to
 * reflect — and this recomputes a tighter box for display only.
 */
export function boxesForValue(
  page: CitationTarget,
  spans: SourceSpan[],
  value: string | null,
): RelativeBox[] {
  const ranges = rangesForValue(page, spans, value) ?? fullRanges(page, spans);
  return ranges.flatMap((r) => boxesForRange(page, r.start, r.end));
}

/**
 * How well the words carrying this value were read.
 *
 * Scored over the value's own words, not the row it was quoted from. A single doubtful
 * token elsewhere in the row — Vision splitting the tail of a "3" into a phantom full
 * stop, say — says nothing about whether the name beside it was read correctly, and
 * scoring the whole row let one such artifact flag every field on the line.
 */
export function valueConfidence(
  page: CitationTarget,
  spans: SourceSpan[],
  value: string | null,
): number {
  const ranges = rangesForValue(page, spans, value) ?? fullRanges(page, spans);
  if (ranges.length === 0) return 1;
  return Math.min(
    ...ranges.map((r) => ocrConfidenceForRange(page, r.start, r.end)),
  );
}

/**
 * How legible the cited row is, as the median confidence across its words.
 *
 * For a value the OCR text does not contain — an entry's aktiv/geloescht state comes from
 * the underline measurement, not from any word — the question is not "was this word read
 * correctly" but "was this row clear enough to measure". The median answers that and
 * survives a single artifact token; the minimum does not.
 */
export function legibilityConfidence(
  page: CitationTarget,
  spans: SourceSpan[],
): number {
  const ranges = fullRanges(page, spans);
  const covered = page.words.filter((word) =>
    ranges.some((r) => word.start < r.end && word.end > r.start),
  );
  if (covered.length === 0) return 1;
  const sorted = covered.map((w) => w.confidence).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The least certain word behind a value, so a low confidence can be explained rather than
 * just displayed. Scored over the same range the confidence is, so the word it names is
 * the one that produced the number.
 */
export function weakestWord(
  page: CitationTarget,
  spans: SourceSpan[],
  value: string | null,
): { text: string; confidence: number } | null {
  const ranges = rangesForValue(page, spans, value) ?? fullRanges(page, spans);
  const covered = page.words.filter((word) =>
    ranges.some((r) => word.start < r.end && word.end > r.start),
  );
  if (covered.length === 0) return null;
  return covered.reduce((weakest, word) =>
    word.confidence < weakest.confidence ? word : weakest,
  );
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
