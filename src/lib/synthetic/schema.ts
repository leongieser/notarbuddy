import { z } from "zod";

/**
 * Ground truth for a generated Grundbuchauszug. The generator renders a PDF from this and
 * writes the same object alongside it, so extraction accuracy can be measured against a
 * known answer instead of eyeballed.
 */

const entryStatus = z.enum(["aktiv", "geloescht"]);

export const syntheticDocumentSchema = z.object({
  /** Courts mark superseded entries either way; both occur in practice. */
  markierungsstil: z.enum(["unterstrichen", "durchgestrichen"]),
  amtsgericht: z.string(),
  grundbuchbezirk: z.string(),
  blatt: z.string(),
  letzteAenderung: z.string(),
  ausdruckVom: z.string(),

  bestandsverzeichnis: z
    .array(
      z.object({
        lfdNr: z.string(),
        gemarkung: z.string(),
        flur: z.string(),
        flurstueck: z.string(),
        wirtschaftsartUndLage: z.string(),
        groesseHa: z.string(),
        groesseA: z.string(),
        groesseQm: z.string(),
      }),
    )
    .min(1),

  eigentuemer: z
    .array(
      z.object({
        lfdNr: z.string(),
        name: z.string(),
        anteil: z.string().nullable(),
        betroffeneGrundstuecke: z.string(),
        grundlageDerEintragung: z.string(),
        status: entryStatus,
      }),
    )
    .min(1),

  abteilung2: z.array(
    z.object({
      lfdNr: z.string(),
      betroffeneGrundstuecke: z.string(),
      text: z.string(),
      status: entryStatus,
    }),
  ),

  abteilung3: z.array(
    z.object({
      lfdNr: z.string(),
      betroffeneGrundstuecke: z.string(),
      betrag: z.string(),
      waehrung: z.string(),
      art: z.string(),
      glaeubiger: z.string(),
      status: entryStatus,
      loeschungsvermerk: z.string().nullable(),
    }),
  ),
});

export type SyntheticDocument = z.infer<typeof syntheticDocumentSchema>;
