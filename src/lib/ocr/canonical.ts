import type { OcrWord } from "@/db/types";

/** Word geometry as Vision reports it, before we assign character offsets. */
export interface RawWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/**
 * Fraction of page width above which a gap between words reads as a column break
 * rather than a space. Relative so it survives any scan resolution.
 */
const COLUMN_GAP_RATIO = 0.028;
const COLUMN_SEPARATOR = "   |   ";

/**
 * Rebuilds reading order from word geometry.
 *
 * Vision's own `fullTextAnnotation.text` interleaves table headers with body cells on
 * Grundbuch forms, which would leave every citation pointing into scrambled prose. So
 * its order is discarded and lines are reconstructed from bounding boxes instead:
 * cluster by vertical midpoint, sort by x, mark wide gaps as column breaks.
 */
export function buildCanonicalText(
  words: RawWord[],
  pageWidth: number,
): { text: string; words: OcrWord[] } {
  if (words.length === 0) return { text: "", words: [] };

  const lines = clusterIntoLines(words);
  const columnGap = pageWidth * COLUMN_GAP_RATIO;

  const placed: OcrWord[] = [];
  let text = "";

  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex > 0) text += "\n";

    for (const [wordIndex, word] of line.entries()) {
      if (wordIndex > 0) {
        const gap = word.x0 - line[wordIndex - 1].x1;
        text += gap > columnGap ? COLUMN_SEPARATOR : " ";
      }
      const start = text.length;
      text += word.text;
      placed.push({ ...word, start, end: text.length });
    }
  }

  return { text, words: placed };
}

function clusterIntoLines(words: RawWord[]): RawWord[][] {
  const byVerticalCentre = [...words].sort((a, b) => centre(a) - centre(b));
  const lines: { centre: number; words: RawWord[] }[] = [];

  for (const word of byVerticalCentre) {
    // Tolerance scales with the word's own height so headings and body text
    // cluster correctly on the same page.
    const tolerance = Math.max((word.y1 - word.y0) * 0.6, 5);
    const line = lines.find(
      (l) => Math.abs(l.centre - centre(word)) < tolerance,
    );

    if (line) {
      line.words.push(word);
      line.centre =
        line.words.reduce((sum, w) => sum + centre(w), 0) / line.words.length;
    } else {
      lines.push({ centre: centre(word), words: [word] });
    }
  }

  return lines
    .sort((a, b) => a.centre - b.centre)
    .map((l) => l.words.sort((a, b) => a.x0 - b.x0));
}

const centre = (w: RawWord) => (w.y0 + w.y1) / 2;
