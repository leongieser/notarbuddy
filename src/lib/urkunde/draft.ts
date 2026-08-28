import type { Field } from "@/db";

/**
 * Renders the Urkunden-Entwurf from confirmed values.
 *
 * Deliberately a template, not a model call. The dataset has already been read by an agent
 * and reviewed by a human; letting a second model rewrite it at the last step would put
 * unreviewed wording into the one artefact that carries legal weight. Everything here is a
 * pure function of values a person signed off.
 */

function valueOf(byPath: Map<string, Field>, path: string): string | null {
  return byPath.get(path)?.value ?? null;
}

function entriesOf(byPath: Map<string, Field>, group: string): number[] {
  const indices = new Set<number>();
  for (const path of byPath.keys()) {
    const match = new RegExp(`^${group}\\[(\\d+)\\]\\.`).exec(path);
    if (match) indices.add(Number(match[1]));
  }
  return [...indices].sort((a, b) => a - b);
}

const isDeleted = (status: string | null) => status === "geloescht";

export function renderDraft(fields: Field[], documentName: string) {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const lines: string[] = [];
  const snapshot: Record<string, string | null> = {};
  for (const field of fields) snapshot[field.path] = field.value;

  const amtsgericht = valueOf(byPath, "grundbuch.amtsgericht");
  const bezirk = valueOf(byPath, "grundbuch.grundbuchbezirk");
  const blatt = valueOf(byPath, "grundbuch.blatt");

  lines.push("URKUNDENENTWURF");
  lines.push("");
  lines.push(`Grundlage: Grundbuchauszug ${documentName}`);
  lines.push(
    `Grundbuch des Amtsgerichts ${amtsgericht ?? "—"}, Grundbuch von ${bezirk ?? "—"}, Blatt ${blatt ?? "—"}.`,
  );
  lines.push("");

  lines.push("I. GRUNDSTÜCK");
  lines.push("");
  const bv = entriesOf(byPath, "bestandsverzeichnis");
  if (bv.length === 0) {
    lines.push("Keine Grundstücke erfasst.");
  }
  for (const i of bv) {
    const at = (key: string) =>
      valueOf(byPath, `bestandsverzeichnis[${i}].${key}`);
    lines.push(
      `${at("lfdNr") ?? i + 1}. Gemarkung ${at("gemarkung") ?? "—"}, Flur ${at("flur") ?? "—"}, ` +
        `Flurstück ${at("flurstueck") ?? "—"}, ${at("wirtschaftsartUndLage") ?? "—"}, ` +
        `Größe ${at("groesse") ?? "—"}.`,
    );
  }
  lines.push("");

  lines.push("II. EIGENTUMSVERHÄLTNISSE");
  lines.push("");
  const owners = entriesOf(byPath, "eigentuemer").filter(
    (i) => !isDeleted(valueOf(byPath, `eigentuemer[${i}].status`)),
  );
  if (owners.length === 0) {
    lines.push("Kein aktueller Eigentümer erfasst.");
  }
  for (const i of owners) {
    const at = (key: string) => valueOf(byPath, `eigentuemer[${i}].${key}`);
    const share = at("anteil");
    lines.push(
      `Als Eigentümer ist eingetragen: ${at("name") ?? "—"}` +
        `${share ? `, zu ${share}` : ""}. Grundlage der Eintragung: ${at("grundlageDerEintragung") ?? "—"}.`,
    );
  }
  lines.push("");

  for (const [group, heading, render] of [
    [
      "abteilung2",
      "III. LASTEN UND BESCHRÄNKUNGEN (ABTEILUNG II)",
      (i: number) => {
        const at = (key: string) => valueOf(byPath, `abteilung2[${i}].${key}`);
        return `Lfd. Nr. ${at("lfdNr") ?? i + 1}, betreffend Grundstück ${at("betroffeneGrundstuecke") ?? "—"}: ${at("text") ?? "—"}`;
      },
    ],
    [
      "abteilung3",
      "IV. GRUNDPFANDRECHTE (ABTEILUNG III)",
      (i: number) => {
        const at = (key: string) => valueOf(byPath, `abteilung3[${i}].${key}`);
        return `Lfd. Nr. ${at("lfdNr") ?? i + 1}: ${at("art") ?? "—"} über ${at("betrag") ?? "—"} ${at("waehrung") ?? ""} für ${at("glaeubiger") ?? "—"}.`;
      },
    ],
  ] as const) {
    lines.push(heading);
    lines.push("");
    const active = entriesOf(byPath, group).filter(
      (i) => !isDeleted(valueOf(byPath, `${group}[${i}].status`)),
    );
    // Deleted entries are omitted from the deed but named, so their absence is a decision
    // on the record rather than something the reader has to notice.
    const deleted = entriesOf(byPath, group).length - active.length;
    if (active.length === 0) {
      lines.push("Keine aktiven Eintragungen.");
    }
    for (const i of active) lines.push(render(i));
    if (deleted > 0) {
      lines.push("");
      lines.push(
        `Hinweis: ${deleted} gelöschte Eintragung${deleted === 1 ? "" : "en"} nicht übernommen.`,
      );
    }
    lines.push("");
  }

  // Deed text only. Who confirmed which field, and what was corrected, lives in the audit
  // log — putting it in the Urkunde would leave a notary deleting our section every time.
  return { content: lines.join("\n"), snapshot };
}
