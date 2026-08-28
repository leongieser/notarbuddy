import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 72, bottom: 64, x: 64 };
const BODY_SIZE = 10.5;
const HEADING_SIZE = 11;
const LEADING = 15.5;
/** Space above a heading, so a section starts as a section rather than as another line. */
const HEADING_SPACE = 10;

/**
 * WinAnsi covers Latin-1 plus the typographic characters the template uses; anything else
 * would make pdf-lib throw mid-document. Substituted rather than dropped, so a mangled
 * character is visible in the draft instead of silently missing from it.
 */
const EXTRA = new Set([
  "€",
  "‚",
  "ƒ",
  "„",
  "…",
  "†",
  "‡",
  "ˆ",
  "‰",
  "Š",
  "‹",
  "Œ",
  "Ž",
  "‘",
  "’",
  "“",
  "”",
  "•",
  "–",
  "—",
  "˜",
  "™",
  "š",
  "›",
  "œ",
  "ž",
  "Ÿ",
]);

function encodable(text: string): string {
  return [...text]
    .map((char) =>
      (char.codePointAt(0) ?? 0) < 256 || EXTRA.has(char) ? char : "?",
    )
    .join("");
}

function wrap(
  text: string,
  size: number,
  width: number,
  measure: (t: string, s: number) => number,
): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size) <= width || line === "") line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** An all-caps line is a section heading in the template; nothing else is. */
function isHeading(line: string): boolean {
  return (
    line.length > 0 && line === line.toUpperCase() && /[A-ZÄÖÜ]/.test(line)
  );
}

/**
 * Typesets the stored draft.
 *
 * A faithful rendering of the text that was generated and recorded, not a second pass over
 * the dataset: the draft in the database is the artefact the audit log points at, and the
 * PDF has to be that same text. Every page carries the draft's id and timestamp so a
 * printout can be traced back to the run and the confirmations behind it.
 */
export async function renderDraftPdf({
  content,
  documentName,
  draftId,
  createdAt,
}: {
  content: string;
  documentName: string;
  draftId: string;
  createdAt: Date;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  pdf.setTitle(`Urkundenentwurf — ${documentName}`);
  pdf.setSubject(`Entwurf ${draftId}`);
  pdf.setProducer("NotaryBuddy");
  pdf.setCreationDate(createdAt);

  const textWidth = A4.width - MARGIN.x * 2;
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN.top;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN.top;
  };

  for (const raw of content.split("\n")) {
    const line = encodable(raw);
    if (line.trim().length === 0) {
      y -= LEADING * 0.6;
      continue;
    }

    const heading = isHeading(line);
    const font = heading ? bold : body;
    const size = heading ? HEADING_SIZE : BODY_SIZE;
    if (heading) y -= HEADING_SPACE;

    for (const piece of wrap(line, size, textWidth, (t, s) =>
      font.widthOfTextAtSize(t, s),
    )) {
      if (y - LEADING < MARGIN.bottom) newPage();
      page.drawText(piece, {
        x: MARGIN.x,
        y,
        size,
        font,
        color: rgb(0.09, 0.09, 0.09),
      });
      y -= LEADING;
    }
  }

  const stamp = `${createdAt.toISOString().slice(0, 16).replace("T", " ")} Uhr`;
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    const footer = encodable(
      `Entwurf ${draftId.slice(0, 8)} · erzeugt ${stamp} · Seite ${index + 1} von ${pages.length}`,
    );
    sheet.drawText(footer, {
      x: MARGIN.x,
      y: MARGIN.bottom - 24,
      size: 7.5,
      font: body,
      color: rgb(0.45, 0.45, 0.45),
    });
  });

  return pdf.save();
}
