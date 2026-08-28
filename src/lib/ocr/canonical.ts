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
export const COLUMN_GAP_RATIO = 0.028;
const COLUMN_SEPARATOR = "   |   ";

/**
 * Vision emits punctuation and hyphens as separate words, so a naive space-join turns
 * "Kiel-Süd" into "Kiel - Süd" and "Wendt," into "Wendt ,". Measured over the samples,
 * such adjacencies sit below 0.36 of the word height while ordinary word spacing starts
 * around 0.58 — this threshold is inside that gap.
 */
const TIGHT_GAP_RATIO = 0.35;

/** Never preceded by a space. */
const TRAILING_PUNCTUATION = /^[,.;:!?)\]}»"']+$/;
/** Never followed by a space. */
const LEADING_PUNCTUATION = /^[([{«]+$/;
const HYPHEN = /^[-–—]$/;

/**
 * Whether two adjacent words on a line should be joined with no space between them.
 * Geometry alone would misjudge tightly-set columns, and punctuation rules alone would
 * misjudge a hyphen used as a dash — both have to agree.
 */
function joinsWithoutSpace(
  previous: string,
  current: string,
  gapRatio: number,
): boolean {
  if (gapRatio > TIGHT_GAP_RATIO) return false;
  if (TRAILING_PUNCTUATION.test(current)) return true;
  if (LEADING_PUNCTUATION.test(previous)) return true;
  // "Gebäude-" keeps its hyphen but still gets a space before "und"; the gap decides.
  return HYPHEN.test(current) || HYPHEN.test(previous);
}

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
  /** Per-line, per-segment strike marks; see `splitIntoSegments`. */
  marks: (string | null)[][] = [],
): { text: string; words: OcrWord[] } {
  if (words.length === 0) return { text: "", words: [] };

  const lines = clusterIntoLines(words);
  const columnGap = pageWidth * COLUMN_GAP_RATIO;

  const placed: OcrWord[] = [];
  let text = "";

  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex > 0) text += "\n";

    let segmentIndex = 0;
    for (const [wordIndex, word] of line.entries()) {
      if (wordIndex > 0) {
        const previous = line[wordIndex - 1];
        const gap = word.x0 - previous.x1;
        const gapRatio = gap / Math.max(word.y1 - word.y0, 1);

        if (gap > columnGap) {
          // The strike is measured from the image and written into the text, so a deleted
          // entry is readable rather than something a model has to notice in a picture.
          const mark = marks[lineIndex]?.[segmentIndex];
          if (mark) text += `  [${mark}]`;
          segmentIndex++;
          text += COLUMN_SEPARATOR;
        } else if (!joinsWithoutSpace(previous.text, word.text, gapRatio)) {
          text += " ";
        }
      }
      const start = text.length;
      text += word.text;
      placed.push({ ...word, start, end: text.length });
    }

    const lastMark = marks[lineIndex]?.[segmentIndex];
    if (lastMark) text += `  [${lastMark}]`;
  }

  return { text, words: placed };
}

/** Splits a line at column breaks, so a cell can be judged on its own. */
export function splitIntoSegments(
  line: RawWord[],
  pageWidth: number,
): RawWord[][] {
  const threshold = pageWidth * COLUMN_GAP_RATIO;
  const segments: RawWord[][] = [[line[0]]];

  for (const word of line.slice(1)) {
    const previous = segments.at(-1)?.at(-1);
    if (previous && word.x0 - previous.x1 > threshold) segments.push([word]);
    else segments.at(-1)?.push(word);
  }
  return segments;
}

export function clusterIntoLines(words: RawWord[]): RawWord[][] {
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

const SECTIONS: [RegExp, string][] = [
  [/abteilung\s*III|abteilung\s*3/i, "Abteilung III"],
  [/abteilung\s*II|abteilung\s*2/i, "Abteilung II"],
  [/abteilung\s*I\b|abteilung\s*1/i, "Abteilung I"],
  [/bestandsverzeichnis/i, "Bestandsverzeichnis"],
];

/**
 * Names a page from its own heading. Only the first lines are considered — the words also
 * appear in body text, where they refer to other sections rather than to this one.
 */
export function detectSection(canonicalText: string | null): string {
  if (!canonicalText) return "";
  const head = canonicalText.split("\n").slice(0, 3).join(" ");
  for (const [pattern, name] of SECTIONS) {
    if (pattern.test(head)) return name;
  }
  return /grundbuch/i.test(head) ? "Deckblatt" : "";
}
