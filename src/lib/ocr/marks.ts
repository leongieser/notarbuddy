import { type RawWord, splitIntoSegments } from "./canonical";

/**
 * Detects struck-through and underlined lines from the page image.
 *
 * In a Grundbuch a superseded entry is marked *only* by a rule through or under the text.
 * That signal is absent from OCR output entirely, and asking a vision model to notice it
 * proved unreliable — the same model reported the same row as struck in one run and clean
 * in the next, both at high confidence.
 *
 * So it is measured rather than perceived: a strike is a horizontal run of dark pixels
 * spanning most of a line's own width, close to that line, and not extending far beyond it
 * (which is what distinguishes it from a table rule).
 */

export type LineMark = "unterstrichen" | "durchgestrichen";

/** Below this luminance a pixel counts as ink. */
const DARK = 140;
/** A strike must run unbroken across this share of the text. */
const MIN_TEXT_COVERAGE = 0.75;
/**
 * A table rule is dark across the column gaps too; a strike is not. Above this share of
 * gap ink the candidate is a rule, not a strike — this is what makes the two separable,
 * since both are equally dark under the text itself.
 */
const MAX_GAP_COVERAGE = 0.3;
/**
 * Ignore very short runs. A three-character signature fragment underlined by a flourish is
 * not evidence that an entry was deleted, and marking it would cry wolf.
 */
const MIN_SEGMENT_WIDTH_RATIO = 0.03;

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function isDark(px: Pixels, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= px.width || y >= px.height) return false;
  const i = (y * px.width + x) * 4;
  if (px.data[i + 3] < 128) return false;
  // Rec. 601 luma is plenty for deciding ink vs paper.
  return (
    0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2] < DARK
  );
}

/**
 * Slope of a line of text, from the drift of its word centres.
 *
 * Scanned pages are never square, and at even half a degree an underline drops several
 * pixels across a cell — enough that a horizontal probe misses it entirely, and enough that
 * the margin check looks where the table rule is not. Both failure directions come from
 * assuming text is level, so the probes follow the text instead.
 */
export function lineSlope(line: RawWord[]): number {
  if (line.length < 2) return 0;

  const points = line.map((w) => ({
    x: (w.x0 + w.x1) / 2,
    y: (w.y0 + w.y1) / 2,
  }));
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (denominator === 0) return 0;

  // Beyond a few degrees this is noise, not skew.
  return Math.max(-0.09, Math.min(0.09, numerator / denominator));
}

function coverage(
  px: Pixels,
  x0: number,
  x1: number,
  y: number,
  slope = 0,
): number {
  let dark = 0;
  const from = Math.round(x0);
  const to = Math.round(x1);
  for (let x = from; x <= to; x++) {
    if (isDark(px, x, Math.round(y + (x - from) * slope))) dark++;
  }
  return dark / Math.max(to - from, 1);
}

/**
 * Longest uninterrupted dark run as a share of the width, tolerating antialiasing gaps.
 *
 * Total coverage is not enough: dense bold text reaches 60% across its x-height band and
 * would read as struck through. A drawn rule is one unbroken run; glyphs are many short
 * ones, so run length separates them where coverage cannot.
 */
function longestRun(
  px: Pixels,
  x0: number,
  x1: number,
  y: number,
  slope = 0,
): number {
  const from = Math.round(x0);
  const to = Math.round(x1);
  let best = 0;
  let current = 0;
  let gap = 0;

  for (let x = from; x <= to; x++) {
    if (isDark(px, x, Math.round(y + (x - from) * slope))) {
      current += gap + 1;
      gap = 0;
      best = Math.max(best, current);
    } else if (current > 0 && gap < 2) {
      gap++;
    } else {
      current = 0;
      gap = 0;
    }
  }
  return best / Math.max(to - from, 1);
}

/**
 * A rule drawn under one cell stops at that cell. A table rule continues past it, into the
 * column gaps on either side — that is what separates the two, since both are equally dark
 * under the text itself.
 */
function struckAt(
  px: Pixels,
  segment: RawWord[],
  from: number,
  to: number,
  pageWidth: number,
  slope: number,
): boolean {
  const x0 = Math.min(...segment.map((w) => w.x0));
  const x1 = Math.max(...segment.map((w) => w.x1));
  const width = x1 - x0;
  if (width < pageWidth * MIN_SEGMENT_WIDTH_RATIO) return false;

  const margin = Math.max(width * 0.15, 8);

  for (let y = from; y <= to; y++) {
    if (longestRun(px, x0, x1, y, slope) < MIN_TEXT_COVERAGE) continue;
    const before = coverage(px, x0 - margin, x0 - 2, y - margin * slope, slope);
    const after = coverage(
      px,
      x1 + 2,
      x1 + margin,
      y + (x1 - x0) * slope,
      slope,
    );
    if (Math.max(before, after) < MAX_GAP_COVERAGE) return true;
  }
  return false;
}

export async function detectLineMarks(
  png: Buffer,
  lines: RawWord[][],
  pageWidth: number,
): Promise<(LineMark | null)[][]> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const raw = ctx.getImageData(0, 0, image.width, image.height);
  const px: Pixels = { data: raw.data, width: raw.width, height: raw.height };

  return lines.map((line) => {
    if (line.length === 0) return [];

    const slope = lineSlope(line);

    return splitIntoSegments(line, pageWidth).map((segment) => {
      const top = Math.min(...segment.map((w) => w.y0));
      const bottom = Math.max(...segment.map((w) => w.y1));
      const height = Math.max(bottom - top, 1);

      // Descenders reach slightly below the reported box, so start just above it.
      if (
        struckAt(
          px,
          segment,
          Math.round(bottom - 2),
          Math.round(bottom + height * 0.5),
          pageWidth,
          slope,
        )
      ) {
        return "unterstrichen" as const;
      }
      if (
        struckAt(
          px,
          segment,
          Math.round(top + height * 0.35),
          Math.round(bottom - height * 0.25),
          pageWidth,
          slope,
        )
      ) {
        return "durchgestrichen" as const;
      }
      return null;
    });
  });
}
