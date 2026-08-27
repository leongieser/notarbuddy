/**
 * The Urkunden dataset, described as a registry of field paths rather than one nested
 * object. The agent records fields one at a time and asks what is still missing, so the
 * shape has to be enumerable, not just parseable.
 */

export interface FieldDefinition {
  key: string;
  label: string;
  hint: string;
}

export interface ListGroup {
  key: string;
  label: string;
  /** Critical groups can never reach a draft without human confirmation. */
  critical: boolean;
  fields: FieldDefinition[];
}

export const SINGLE_FIELDS: FieldDefinition[] = [
  {
    key: "grundbuch.amtsgericht",
    label: "Amtsgericht",
    hint: "Name des Amtsgerichts, ohne Ort-Zusatz.",
  },
  {
    key: "grundbuch.grundbuchbezirk",
    label: "Grundbuch von",
    hint: "Grundbuchbezirk, z. B. „Muster Bezirk 11“.",
  },
  {
    key: "grundbuch.blatt",
    label: "Blatt",
    hint: "Blattnummer. Achtung: die Ziffernfolge kann im Druck getrennt wirken.",
  },
];

export const LIST_GROUPS: ListGroup[] = [
  {
    key: "bestandsverzeichnis",
    label: "Bestandsverzeichnis",
    critical: false,
    fields: [
      {
        key: "lfdNr",
        label: "Lfd. Nr.",
        hint: "Laufende Nummer des Grundstücks.",
      },
      {
        key: "gemarkung",
        label: "Gemarkung",
        hint: "Gemarkung bzw. Vermessungsbezirk.",
      },
      { key: "flur", label: "Flur", hint: "Flurnummer." },
      {
        key: "flurstueck",
        label: "Flurstück",
        hint: "Flurstücksnummer, z. B. „2/31“.",
      },
      {
        key: "wirtschaftsartUndLage",
        label: "Wirtschaftsart und Lage",
        hint: "Nutzungsart und Anschrift.",
      },
      {
        key: "groesse",
        label: "Größe",
        hint: "Fläche mit Einheit, z. B. „1 ha 19 a“.",
      },
    ],
  },
  {
    key: "eigentuemer",
    label: "Eigentümer",
    critical: true,
    fields: [
      {
        key: "name",
        label: "Name",
        hint: "Vollständiger Name oder Firma des Eigentümers.",
      },
      {
        key: "anteil",
        label: "Anteil",
        hint: "Miteigentumsanteil, falls angegeben.",
      },
      {
        key: "grundlageDerEintragung",
        label: "Grundlage der Eintragung",
        hint: "Auflassung und Eintragungsdatum.",
      },
      {
        key: "status",
        label: "Status",
        hint: "„aktiv“ oder „geloescht“. Unterstrichene oder durchgestrichene Einträge sind gelöscht.",
      },
    ],
  },
  {
    key: "abteilung2",
    label: "Abteilung II — Lasten und Beschränkungen",
    critical: true,
    fields: [
      {
        key: "lfdNr",
        label: "Lfd. Nr.",
        hint: "Laufende Nummer der Eintragung.",
      },
      {
        key: "betroffeneGrundstuecke",
        label: "Betroffene Grundstücke",
        hint: "Laufende Nummern aus dem Bestandsverzeichnis.",
      },
      {
        key: "text",
        label: "Eintragungstext",
        hint: "Wortlaut der Last oder Beschränkung.",
      },
      { key: "status", label: "Status", hint: "„aktiv“ oder „geloescht“." },
    ],
  },
  {
    key: "abteilung3",
    label: "Abteilung III — Grundpfandrechte",
    critical: true,
    fields: [
      {
        key: "lfdNr",
        label: "Lfd. Nr.",
        hint: "Laufende Nummer der Eintragung.",
      },
      {
        key: "betrag",
        label: "Betrag",
        hint: "Nennbetrag als Zahl, ohne Währung.",
      },
      { key: "waehrung", label: "Währung", hint: "z. B. „EUR“ oder „DM“." },
      {
        key: "art",
        label: "Art",
        hint: "Grundschuld, Hypothek, Rentenschuld …",
      },
      {
        key: "glaeubiger",
        label: "Gläubiger",
        hint: "Begünstigter des Rechts.",
      },
      { key: "status", label: "Status", hint: "„aktiv“ oder „geloescht“." },
    ],
  },
];

const LIST_BY_KEY = new Map(LIST_GROUPS.map((g) => [g.key, g]));
const SINGLE_BY_KEY = new Map(SINGLE_FIELDS.map((f) => [f.key, f]));

export interface ParsedPath {
  group: string;
  index: number | null;
  field: string;
  critical: boolean;
  label: string;
}

const LIST_PATH = /^([a-zA-Z0-9]+)\[(\d+)\]\.([a-zA-Z0-9]+)$/;

/** Returns null for any path the schema does not define, so the agent cannot invent fields. */
export function parseFieldPath(path: string): ParsedPath | null {
  const single = SINGLE_BY_KEY.get(path);
  if (single) {
    return {
      group: "grundbuch",
      index: null,
      field: path,
      critical: false,
      label: single.label,
    };
  }

  const match = LIST_PATH.exec(path);
  if (!match) return null;

  const [, groupKey, indexText, fieldKey] = match;
  const group = LIST_BY_KEY.get(groupKey);
  const field = group?.fields.find((f) => f.key === fieldKey);
  if (!group || !field) return null;

  return {
    group: groupKey,
    index: Number(indexText),
    field: fieldKey,
    critical: group.critical,
    label: `${group.label} ${Number(indexText) + 1} — ${field.label}`,
  };
}

/** Rendered into the system prompt so the model sees exactly which paths exist. */
export function describeSchema(): string {
  const singles = SINGLE_FIELDS.map((f) => `  ${f.key} — ${f.hint}`).join("\n");
  const lists = LIST_GROUPS.map((g) => {
    const fields = g.fields
      .map((f) => `    ${g.key}[i].${f.key} — ${f.hint}`)
      .join("\n");
    return `  ${g.label}${g.critical ? "  (kritisch)" : ""}\n${fields}`;
  }).join("\n\n");
  return `Einzelfelder:\n${singles}\n\nListen (i ist der 0-basierte Index eines Eintrags):\n${lists}`;
}
