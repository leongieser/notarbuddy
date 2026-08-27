import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type { SyntheticDocument } from "./schema";

/**
 * Draws a Grundbuchauszug close enough to a real court printout to exercise the OCR and
 * the geometry-based reading order: ruled columns, cells that wrap across lines, and
 * deleted entries marked *only* by underlining — the case that cannot be read from text.
 */

const PAGE = { width: 842, height: 595 };
const MARGIN = 28;
const FONT_SIZE = 7;
const LINE_HEIGHT = 9;
const CELL_PAD = 3;
const BLACK = rgb(0, 0, 0);

interface Fonts {
  body: PDFFont;
  bold: PDFFont;
}

interface Column {
  header: string;
  width: number;
}

interface Row {
  cells: string[];
  deleted?: boolean;
}

type MarkStyle = "unterstrichen" | "durchgestrichen";

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawRow(
  page: PDFPage,
  fonts: Fonts,
  columns: Column[],
  row: Row,
  top: number,
  opts: { header?: boolean; size?: number; mark?: MarkStyle } = {},
): number {
  const size = opts.size ?? FONT_SIZE;
  const font = opts.header ? fonts.bold : fonts.body;

  const wrapped = row.cells.map((cell, i) =>
    wrap(cell, font, size, columns[i].width - CELL_PAD * 2),
  );
  const height =
    Math.max(...wrapped.map((l) => l.length)) * LINE_HEIGHT + CELL_PAD * 2;

  let x = MARGIN;
  for (const [i, lines] of wrapped.entries()) {
    for (const [l, line] of lines.entries()) {
      const y = top - CELL_PAD - LINE_HEIGHT * (l + 1) + 2;
      page.drawText(line, { x: x + CELL_PAD, y, size, font, color: BLACK });

      // A deleted entry is struck only by this rule — nothing in the text says so.
      if (row.deleted && line) {
        const width = font.widthOfTextAtSize(line, size);
        const strikeY =
          opts.mark === "durchgestrichen" ? y + size * 0.3 : y - 1.5;
        page.drawLine({
          start: { x: x + CELL_PAD, y: strikeY },
          end: { x: x + CELL_PAD + width, y: strikeY },
          thickness: 0.6,
          color: BLACK,
        });
      }
    }

    if (i < columns.length - 1) {
      page.drawLine({
        start: { x: x + columns[i].width, y: top },
        end: { x: x + columns[i].width, y: top - height },
        thickness: 0.6,
        color: BLACK,
      });
    }
    x += columns[i].width;
  }

  page.drawLine({
    start: { x: MARGIN, y: top - height },
    end: { x: PAGE.width - MARGIN, y: top - height },
    thickness: 0.6,
    color: BLACK,
  });

  return top - height;
}

function sheetHeader(
  page: PDFPage,
  fonts: Fonts,
  doc: SyntheticDocument,
  section: string,
) {
  const y = PAGE.height - MARGIN - 10;
  const pairs: [string, string][] = [
    ["Amtsgericht", doc.amtsgericht],
    ["Grundbuch von", doc.grundbuchbezirk],
    ["Blatt", doc.blatt],
  ];

  let x = MARGIN;
  for (const [label, value] of pairs) {
    page.drawText(label, { x, y, size: 9, font: fonts.bold, color: BLACK });
    page.drawText(value, {
      x: x + fonts.bold.widthOfTextAtSize(label, 9) + 8,
      y,
      size: 8,
      font: fonts.body,
      color: BLACK,
    });
    x += 230;
  }
  page.drawText(section, {
    x: PAGE.width - MARGIN - 110,
    y,
    size: 10,
    font: fonts.bold,
    color: BLACK,
  });

  return y - 18;
}

function footer(
  page: PDFPage,
  fonts: Fonts,
  doc: SyntheticDocument,
  pageNo: number,
) {
  page.drawText(
    `${doc.grundbuchbezirk} ${doc.blatt} · Letzte Änderung ${doc.letzteAenderung} · Ausdruck vom ${doc.ausdruckVom} · Seite ${pageNo} von 5`,
    { x: MARGIN, y: 18, size: 6, font: fonts.body, color: rgb(0.3, 0.3, 0.3) },
  );
}

function table(
  page: PDFPage,
  fonts: Fonts,
  top: number,
  columns: Column[],
  rows: Row[],
  mark: MarkStyle = "unterstrichen",
) {
  page.drawLine({
    start: { x: MARGIN, y: top },
    end: { x: PAGE.width - MARGIN, y: top },
    thickness: 0.6,
    color: BLACK,
  });

  let y = drawRow(
    page,
    fonts,
    columns,
    { cells: columns.map((c) => c.header) },
    top,
    {
      header: true,
      size: 6,
    },
  );
  y = drawRow(
    page,
    fonts,
    columns,
    { cells: columns.map((_, i) => String(i + 1)) },
    y,
    { size: 5.5 },
  );
  for (const row of rows) y = drawRow(page, fonts, columns, row, y, { mark });

  page.drawLine({
    start: { x: MARGIN, y: top },
    end: { x: MARGIN, y },
    thickness: 0.6,
    color: BLACK,
  });
  page.drawLine({
    start: { x: PAGE.width - MARGIN, y: top },
    end: { x: PAGE.width - MARGIN, y },
    thickness: 0.6,
    color: BLACK,
  });
}

function columns(widths: number[], headers: string[]): Column[] {
  const usable = PAGE.width - MARGIN * 2;
  const total = widths.reduce((a, b) => a + b, 0);
  return headers.map((header, i) => ({
    header,
    width: (widths[i] / total) * usable,
  }));
}

export async function renderSyntheticPdf(
  doc: SyntheticDocument,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Grundbuch von ${doc.grundbuchbezirk} Blatt ${doc.blatt}`);

  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Courier),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const cover = pdf.addPage([PAGE.width, PAGE.height]);
  cover.drawText("Amtsgericht", {
    x: MARGIN,
    y: PAGE.height - MARGIN - 10,
    size: 9,
    font: fonts.bold,
  });
  cover.drawText(doc.amtsgericht, {
    x: MARGIN + 70,
    y: PAGE.height - MARGIN - 10,
    size: 8,
    font: fonts.body,
  });
  const title = "Grundbuch";
  cover.drawText(title, {
    x: (PAGE.width - fonts.bold.widthOfTextAtSize(title, 22)) / 2,
    y: PAGE.height / 2 + 40,
    size: 22,
    font: fonts.bold,
  });
  for (const [i, line] of [
    "von",
    doc.grundbuchbezirk,
    `Blatt ${doc.blatt}`,
  ].entries()) {
    cover.drawText(line, {
      x: (PAGE.width - fonts.body.widthOfTextAtSize(line, 11)) / 2,
      y: PAGE.height / 2 - i * 22,
      size: 11,
      font: fonts.body,
    });
  }
  footer(cover, fonts, doc, 1);

  const bv = pdf.addPage([PAGE.width, PAGE.height]);
  table(
    bv,
    fonts,
    sheetHeader(bv, fonts, doc, "Bestandsverzeichnis"),
    columns(
      [7, 16, 7, 9, 34, 6, 6, 7],
      [
        "Laufende Nummer der Grundstücke",
        "Gemarkung (Vermessungsbezirk)",
        "Flur",
        "Flurstück",
        "Wirtschaftsart und Lage",
        "ha",
        "a",
        "m²",
      ],
    ),
    doc.bestandsverzeichnis.map((b) => ({
      cells: [
        b.lfdNr,
        b.gemarkung,
        b.flur,
        b.flurstueck,
        b.wirtschaftsartUndLage,
        b.groesseHa,
        b.groesseA,
        b.groesseQm,
      ],
    })),
  );
  footer(bv, fonts, doc, 2);

  const abt1 = pdf.addPage([PAGE.width, PAGE.height]);
  table(
    abt1,
    fonts,
    sheetHeader(abt1, fonts, doc, "Abteilung I"),
    columns(
      [8, 40, 12, 40],
      [
        "Laufende Nummer der Eintragungen",
        "Eigentümer",
        "Laufende Nummer der Grundstücke im Bestandsverzeichnis",
        "Grundlage der Eintragung",
      ],
    ),
    doc.eigentuemer.map((e) => ({
      cells: [
        e.lfdNr,
        e.anteil ? `${e.name}, zu ${e.anteil}` : e.name,
        e.betroffeneGrundstuecke,
        e.grundlageDerEintragung,
      ],
      deleted: e.status === "geloescht",
    })),
    doc.markierungsstil,
  );
  footer(abt1, fonts, doc, 3);

  const abt2 = pdf.addPage([PAGE.width, PAGE.height]);
  table(
    abt2,
    fonts,
    sheetHeader(abt2, fonts, doc, "Abteilung II"),
    columns(
      [8, 14, 78],
      [
        "Laufende Nummer der Eintragungen",
        "Laufende Nummer der belasteten Grundstücke",
        "Lasten und Beschränkungen",
      ],
    ),
    doc.abteilung2.map((a) => ({
      cells: [a.lfdNr, a.betroffeneGrundstuecke, a.text],
      deleted: a.status === "geloescht",
    })),
    doc.markierungsstil,
  );
  footer(abt2, fonts, doc, 4);

  const abt3 = pdf.addPage([PAGE.width, PAGE.height]);
  table(
    abt3,
    fonts,
    sheetHeader(abt3, fonts, doc, "Abteilung III"),
    columns(
      [7, 12, 16, 65],
      [
        "Laufende Nummer der Eintragungen",
        "Laufende Nummer der belasteten Grundstücke",
        "Betrag",
        "Hypotheken, Grundschulden, Rentenschulden",
      ],
    ),
    doc.abteilung3.map((a) => ({
      cells: [
        a.lfdNr,
        a.betroffeneGrundstuecke,
        `${a.betrag} ${a.waehrung}`,
        `${a.art} für ${a.glaeubiger}`,
      ],
      deleted: a.status === "geloescht",
    })),
    doc.markierungsstil,
  );
  footer(abt3, fonts, doc, 5);

  return Buffer.from(await pdf.save());
}
