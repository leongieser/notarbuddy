import { eq } from "drizzle-orm";
import { db, fields, pages } from "@/db";

/**
 * The approval gate.
 *
 * Critical fields — owners and encumbrances — require a human decision before a draft can
 * exist. This lives on the server and is checked inside the draft endpoint itself rather
 * than in the UI, because a gate the client enforces is not a gate: the assignment
 * explicitly requires it to hold for a direct API call that bypasses the interface.
 */

export const HUMAN_RESOLVED = ["confirmed", "corrected"] as const;

export interface GateBlocker {
  kind: "field" | "page";
  reference: string;
  reason: string;
}

export interface GateResult {
  open: boolean;
  blockers: GateBlocker[];
  criticalTotal: number;
  criticalResolved: number;
}

export async function evaluateGate(documentId: string): Promise<GateResult> {
  const [allFields, docPages] = await Promise.all([
    db.select().from(fields).where(eq(fields.documentId, documentId)),
    db.select().from(pages).where(eq(pages.documentId, documentId)),
  ]);

  const critical = allFields.filter((f) => f.critical);
  const resolved = critical.filter((f) =>
    (HUMAN_RESOLVED as readonly string[]).includes(f.status),
  );

  const blockers: GateBlocker[] = [];

  // An unread page means the document was never fully seen. Whatever the fields say, the
  // dataset cannot be complete, so the draft is not a draft of this document.
  for (const page of docPages.filter((p) => p.ocrStatus !== "ok")) {
    blockers.push({
      kind: "page",
      reference: `Seite ${page.pageIndex + 1}`,
      reason:
        page.ocrStatus === "failed"
          ? `nicht gelesen: ${page.ocrError?.message ?? "unbekannter Fehler"}`
          : "noch nicht gelesen",
    });
  }

  if (critical.length === 0) {
    blockers.push({
      kind: "field",
      reference: "Datensatz",
      reason: "Es wurden keine kritischen Felder erfasst.",
    });
  }

  for (const field of critical) {
    if ((HUMAN_RESOLVED as readonly string[]).includes(field.status)) continue;
    blockers.push({
      kind: "field",
      reference: field.path,
      reason:
        field.status === "flagged"
          ? "zur Prüfung markiert, noch nicht entschieden"
          : "noch nicht bestätigt",
    });
  }

  return {
    open: blockers.length === 0,
    blockers,
    criticalTotal: critical.length,
    criticalResolved: resolved.length,
  };
}
