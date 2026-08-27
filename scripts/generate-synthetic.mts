import { writeFile } from "node:fs/promises";
import path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { renderSyntheticPdf } from "../src/lib/synthetic/render.ts";
import { HARSH, MILD, scanify, UNREADABLE } from "../src/lib/synthetic/scan.ts";
import { syntheticDocumentSchema } from "../src/lib/synthetic/schema.ts";

process.loadEnvFile(".env.local");

const MODEL = "claude-haiku-4-5";
const OUT = path.join(process.cwd(), "samples");

const VARIANTS = [
  {
    name: "synthetic-erbengemeinschaft",
    scan: null,
    brief:
      "Ein Wohngrundstück in Norddeutschland, das an eine Erbengemeinschaft aus drei natürlichen Personen übergegangen ist. Jede Person hält einen Miteigentumsanteil (z. B. 1/3). Der frühere Alleineigentümer ist gelöscht. In Abteilung II ein Wegerecht, in Abteilung III eine valutierende Grundschuld und eine ältere, bereits gelöschte Hypothek in DM. Markierungsstil: unterstrichen.",
  },
  {
    name: "synthetic-zwangsversteigerung",
    scan: null,
    brief:
      "Ein gewerbliches Grundstück mit zwei Flurstücken in Süddeutschland, im Eigentum einer GmbH mit langer Firmierung. In Abteilung II ein Zwangsversteigerungsvermerk und eine beschränkt persönliche Dienstbarkeit für einen Energieversorger, eine davon gelöscht mit Löschungsvermerk. In Abteilung III zwei Grundschulden verschiedener Banken. Markierungsstil: durchgestrichen.",
  },
  {
    name: "synthetic-wohnungseigentum",
    scan: null,
    brief:
      "Wohnungseigentum: ein Miteigentumsanteil verbunden mit dem Sondereigentum an einer Wohnung, dazu ein Sondernutzungsrecht an einem Stellplatz. Zwei Eigentümer in ehelicher Gütergemeinschaft. Abteilung II enthält KEINE Eintragungen (leeres Array). Abteilung III enthält drei Grundschulden, davon zwei gelöscht mit Löschungsvermerk. Markierungsstil: unterstrichen.",
  },
  {
    name: "synthetic-erbbaurecht-scan",
    scan: MILD,
    brief:
      "Ein Erbbaurecht an einem Grundstück einer Kirchengemeinde, Eigentümer ist ein Ehepaar. Abteilung II enthält eine Reallast, ein Vorkaufsrecht und einen Nacherbenvermerk. Abteilung III enthält genau eine Grundschuld. Ein früherer Eigentümer ist gelöscht. Markierungsstil: unterstrichen.",
  },
  {
    name: "synthetic-landwirtschaft-scan",
    scan: HARSH,
    brief:
      "Ein landwirtschaftlicher Betrieb mit vier Flurstücken unterschiedlicher Größe, im Eigentum einer natürlichen Person. Abteilung II enthält ein Leitungsrecht und ein Altenteil/Leibgeding. Abteilung III enthält zwei Grundschulden, eine davon gelöscht. Markierungsstil: durchgestrichen.",
  },
  {
    name: "synthetic-unlesbar-scan",
    scan: UNREADABLE,
    brief:
      "Ein einfaches Einfamilienhausgrundstück mit einem Eigentümer, einer Dienstbarkeit in Abteilung II und einer Grundschuld in Abteilung III. Ein früherer Eigentümer ist gelöscht. Markierungsstil: unterstrichen.",
  },
];

const INSTRUCTIONS = `Du erzeugst realistische Testdaten für einen deutschen Grundbuchauszug.

Wichtig:
- Erfinde die Daten vollständig. Verwende KEINE realen Personen, Firmen oder Banken und
  keine Namen aus tatsächlichen Handelsregistern. Orte dürfen real sein.
- Verwende NICHT die Platzhalter "Muster", "Musterstadt", "Mustermann" oder Varianten davon.
  Die Daten sollen wie ein echter Auszug wirken, nicht wie ein Formularmuster.
- Schreibe Beträge mit Tausenderpunkt und Dezimalkomma, z. B. "250.000,00".
- Datumsangaben im Format TT.MM.JJJJ.
- Eintragungstexte in Abteilung II und III im Behördendeutsch eines Grundbuchamts,
  einschließlich Bezugnahme auf Bewilligung und Eintragungsdatum.
- Größenangaben getrennt nach ha, a und m². Leere Spalten als leerer String.
- "grundlageDerEintragung" nennt Auflassung bzw. Erbfolge mit Datum und Eintragungsdatum.
- Mindestens ein Eintrag im Dokument muss status "geloescht" haben.
- "markierungsstil" wie in der Beschreibung angegeben setzen.
- "loeschungsvermerk" nur bei gelöschten Einträgen füllen, sonst null.
- Mindestens ein Eigentümer muss eine lange Firmierung tragen (Rechtsform ausgeschrieben,
  Sitz und ggf. Zusatz), sodass die Zelle über mehrere Zeilen umbricht. Die zugehörige
  "grundlageDerEintragung" soll ebenfalls lang sein und mehrere Zeilen füllen — im echten
  Auszug brechen mehrere Spalten derselben Zeile gleichzeitig um, und genau das soll der
  Testdatensatz abbilden.`;

for (const variant of VARIANTS) {
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: syntheticDocumentSchema,
    system: INSTRUCTIONS,
    prompt: variant.brief,
    temperature: 1,
  });

  const rendered = await renderSyntheticPdf(object);
  const pdf = variant.scan ? await scanify(rendered, variant.scan) : rendered;
  await writeFile(path.join(OUT, `${variant.name}.pdf`), pdf);
  await writeFile(
    path.join(OUT, `${variant.name}.truth.json`),
    `${JSON.stringify(object, null, 2)}\n`,
  );

  const deleted = [
    ...object.eigentuemer,
    ...object.abteilung2,
    ...object.abteilung3,
  ].filter((e) => e.status === "geloescht").length;

  console.log(
    `${variant.name}.pdf — ${object.grundbuchbezirk} Blatt ${object.blatt}, ` +
      `${object.eigentuemer.length} Eigentümer, ${object.abteilung2.length} Abt. II, ` +
      `${object.abteilung3.length} Abt. III, ${deleted} gelöscht`,
  );
}
