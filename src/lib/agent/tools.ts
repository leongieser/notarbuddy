import { readFile } from "node:fs/promises";
import { tool } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, events, fields, pages } from "@/db";
import type { SourceSpan } from "@/db/types";
import { resolvePageImage } from "@/lib/ingest/storage";
import { OcrFailure, ocrPage } from "@/lib/ocr";
import {
  LIST_GROUPS,
  parseFieldPath,
  SINGLE_FIELDS,
} from "@/lib/urkunde/schema";
import {
  CitationError,
  type CitationTarget,
  legibilityConfidence,
  locateQuote,
  valueConfidence,
} from "./citation";

/**
 * Undoes a JSON escape a model wrote out as literal characters.
 *
 * `JSON.stringify` never produces `\uXXXX` for these, so a note reading "f\u00fcr den
 * ersten Eigent\u00fcmer" is the model escaping its own arguments a second time. Decoded
 * here at the boundary rather than on display, so what lands in the field and in the audit
 * log is the text itself — the audit log is supposed to be readable three weeks later.
 */
function decodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isNaN(code) ? match : String.fromCharCode(code);
  });
}

/** Below this, a value is flagged for review rather than presented as extracted. */
const CONFIDENCE_THRESHOLD = 0.8;

/**
 * A badly scanned page is its own failure mode, distinct from a page the agent read and
 * misunderstood. Naming the reading quality lets the agent treat a poor scan as poor
 * evidence instead of transcribing noise with confidence.
 */
function describeQuality(confidence: number | null): string {
  if (confidence === null) return "unbekannt";
  if (confidence >= 0.9) return `gut (${confidence.toFixed(2)})`;
  if (confidence >= 0.75) return `mäßig (${confidence.toFixed(2)})`;
  return `schlecht (${confidence.toFixed(2)}) — Vorlage kaum lesbar`;
}

/**
 * Page images are resent with the whole history on every step, and image cost scales with
 * area. Underlines and strikethroughs are still plainly visible at this width, while the
 * full 2x raster costs roughly three times as many tokens per step.
 */
const MODEL_IMAGE_WIDTH = 1100;

async function downscaleForModel(png: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  if (img.width <= MODEL_IMAGE_WIDTH) return png;

  const scale = MODEL_IMAGE_WIDTH / img.width;
  const canvas = createCanvas(
    MODEL_IMAGE_WIDTH,
    Math.round(img.height * scale),
  );
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

async function loadPage(
  documentId: string,
  pageIndex: number,
): Promise<CitationTarget | null> {
  const [page] = await db
    .select()
    .from(pages)
    .where(
      and(eq(pages.documentId, documentId), eq(pages.pageIndex, pageIndex)),
    )
    .limit(1);

  if (!page?.canonicalText || !page.words) return null;
  return {
    pageId: page.id,
    pageIndex: page.pageIndex,
    canonicalText: page.canonicalText,
    words: page.words,
    width: page.width,
    height: page.height,
  };
}

export function buildTools(documentId: string, runId: string) {
  const actor = `agent:${runId}` as const;

  return {
    list_pages: tool({
      description:
        "Listet alle Seiten mit ihrem Lesestatus. Immer zuerst aufrufen, um zu sehen, was schon gelesen ist.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await db
          .select()
          .from(pages)
          .where(eq(pages.documentId, documentId))
          .orderBy(asc(pages.pageIndex));
        return rows.map((p) => ({
          pageIndex: p.pageIndex,
          ocrStatus: p.ocrStatus,
          ocrError: p.ocrError?.code ?? null,
          characters: p.canonicalText?.length ?? 0,
          leseQualitaet: describeQuality(p.ocrConfidence),
        }));
      },
    }),

    ocr_page: tool({
      description:
        "Liest eine Seite per OCR und gibt den Text mit Zeichenpositionen zurück. Schlägt das fehl, ist der Inhalt dieser Seite unbekannt — nicht raten.",
      inputSchema: z.object({ pageIndex: z.number().int().min(0) }),
      execute: async ({ pageIndex }) => {
        const [page] = await db
          .select()
          .from(pages)
          .where(
            and(
              eq(pages.documentId, documentId),
              eq(pages.pageIndex, pageIndex),
            ),
          )
          .limit(1);
        if (!page)
          return {
            ok: false as const,
            error: {
              code: "NOT_FOUND",
              message: `Seite ${pageIndex} existiert nicht.`,
              retryable: false,
            },
          };

        try {
          const updated = await ocrPage(page.id);
          return {
            ok: true as const,
            pageIndex,
            text: updated.canonicalText ?? "",
          };
        } catch (error) {
          const detail = error instanceof OcrFailure ? error.detail : null;
          await db.insert(events).values({
            documentId,
            actor,
            action: "ocr_failed",
            evidence: { reason: detail?.message ?? String(error) },
          });
          return {
            ok: false as const,
            error: detail ?? {
              code: "NETWORK",
              message: String(error),
              retryable: true,
            },
          };
        }
      },
    }),

    get_page_text: tool({
      description:
        "Gibt den Text einer bereits gelesenen Seite erneut zurück. Nur nötig, wenn du den Text aus ocr_page nicht mehr vorliegen hast.",
      inputSchema: z.object({ pageIndex: z.number().int().min(0) }),
      execute: async ({ pageIndex }) => {
        const page = await loadPage(documentId, pageIndex);
        if (!page)
          return {
            ok: false as const,
            error: "Seite noch nicht gelesen. Zuerst ocr_page aufrufen.",
          };
        return {
          ok: true as const,
          pageIndex,
          characters: page.canonicalText.length,
          text: page.canonicalText,
        };
      },
    }),

    view_page: tool({
      description:
        "Zeigt das Seitenbild. Notwendig, um Unterstreichungen und Durchstreichungen zu erkennen — gelöschte Einträge sind im OCR-Text nicht von aktuellen unterscheidbar.",
      inputSchema: z.object({ pageIndex: z.number().int().min(0) }),
      execute: async ({ pageIndex }) => {
        const [page] = await db
          .select()
          .from(pages)
          .where(
            and(
              eq(pages.documentId, documentId),
              eq(pages.pageIndex, pageIndex),
            ),
          )
          .limit(1);
        if (!page)
          return { png: null, message: `Seite ${pageIndex} existiert nicht.` };
        const png = await downscaleForModel(
          await readFile(resolvePageImage(page.imagePath)),
        );
        return { png: png.toString("base64"), message: null };
      },
      toModelOutput: ({ output }) => ({
        type: "content" as const,
        value: output.png
          ? [
              {
                type: "file" as const,
                mediaType: "image/png",
                data: { type: "data" as const, data: output.png },
              },
            ]
          : [{ type: "text" as const, text: output.message ?? "" }],
      }),
    }),

    record_fields: tool({
      description:
        "Trägt mehrere Werte auf einmal ein. Zu jedem Wert gehört ein `quote` — der Wortlaut, der ihn belegt. Der Server sucht die Fundstelle selbst; du musst keine Zeichenpositionen zählen. Fasse pro Seite zusammen, was du belegen kannst.",
      inputSchema: z.object({
        entries: z
          .array(
            z.object({
              path: z.string().describe("z. B. eigentuemer[0].name"),
              value: z.string(),
              confidence: z.number().min(0).max(1),
              pageIndex: z.number().int().min(0),
              quotes: z
                .array(z.string())
                .min(1)
                .describe(
                  "Wortlaute aus dem Seitentext, die diesen Wert belegen. Jedes Zitat muss eindeutig sein — im Zweifel länger zitieren. Mehrere Zitate für über Zeilen umbrochene Zellen: „MusterReal International Real“, „Estate Kapitalanlagegesellschaft“, „mbH Hamburg“.",
                ),
              note: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ entries }) => {
        const pageCache = new Map<number, CitationTarget | null>();
        const results: {
          path: string;
          ok: boolean;
          error?: string;
          status?: string;
          confidence?: number;
        }[] = [];

        for (const entry of entries) {
          const parsed = parseFieldPath(entry.path);
          if (!parsed) {
            results.push({
              path: entry.path,
              ok: false,
              error: `Unbekanntes Feld: ${entry.path}`,
            });
            continue;
          }

          if (!pageCache.has(entry.pageIndex)) {
            pageCache.set(
              entry.pageIndex,
              await loadPage(documentId, entry.pageIndex),
            );
          }
          const page = pageCache.get(entry.pageIndex);
          if (!page) {
            results.push({
              path: entry.path,
              ok: false,
              error: `Seite ${entry.pageIndex} ist noch nicht gelesen.`,
            });
            continue;
          }

          const value = decodeEscapes(entry.value);
          const note = entry.note ? decodeEscapes(entry.note) : undefined;

          let spans: SourceSpan[];
          try {
            spans = entry.quotes.map((quote) =>
              locateQuote(page, decodeEscapes(quote)),
            );
          } catch (error) {
            if (error instanceof CitationError) {
              results.push({
                path: entry.path,
                ok: false,
                error: error.message,
              });
              continue;
            }
            throw error;
          }

          // What the OCR confidence should measure depends on where the value came from.
          // A name is words, so the weakest of those words drags it down. An entry's
          // aktiv/geloescht state is not in the text at all — it comes from the underline
          // measurement — so what matters there is whether the row was legible enough to
          // measure, which the median answers and the minimum does not.
          const reading =
            parsed.field === "status"
              ? legibilityConfidence(page, spans)
              : valueConfidence(page, spans, value);
          const effective = Math.min(entry.confidence, reading);
          const status =
            effective < CONFIDENCE_THRESHOLD ? "flagged" : "extracted";

          await upsertField({
            documentId,
            actor,
            path: entry.path,
            value,
            confidence: effective,
            spans,
            status,
            critical: parsed.critical,
            note: note ?? null,
          });

          results.push({
            path: entry.path,
            ok: true,
            status,
            confidence: Number(effective.toFixed(2)),
          });
        }

        const rejected = results.filter((r) => !r.ok);
        return {
          recorded: results.length - rejected.length,
          rejected: rejected.length,
          // Only the failures need detail; echoing every success back wastes context.
          failures: rejected,
        };
      },
    }),

    flag_field: tool({
      description:
        "Markiert ein Feld als ungeklärt. Zu benutzen, wenn der Auszug den Wert nicht hergibt — niemals stattdessen raten.",
      inputSchema: z.object({
        path: z.string(),
        reason: z.string(),
      }),
      execute: async ({ path, reason }) => {
        const parsed = parseFieldPath(path);
        if (!parsed)
          return { ok: false as const, error: `Unbekanntes Feld: ${path}` };

        await upsertField({
          documentId,
          actor,
          path,
          value: null,
          confidence: 0,
          spans: null,
          status: "flagged",
          critical: parsed.critical,
          note: decodeEscapes(reason),
        });
        return { ok: true as const, path, status: "flagged" };
      },
    }),

    check_completeness: tool({
      description:
        "Zeigt, welche Felder noch fehlen oder markiert sind. Damit entscheidest du, was als Nächstes zu tun ist.",
      inputSchema: z.object({}),
      execute: async () => {
        const recorded = await db
          .select()
          .from(fields)
          .where(eq(fields.documentId, documentId));
        const byPath = new Map(recorded.map((f) => [f.path, f]));

        const missingSingles = SINGLE_FIELDS.filter(
          (f) => !byPath.has(f.key),
        ).map((f) => f.key);
        const groups = LIST_GROUPS.map((g) => {
          const entries = recorded.filter((f) =>
            f.path.startsWith(`${g.key}[`),
          );
          const indices = new Set(
            entries.map((f) => f.path.match(/\[(\d+)\]/)?.[1]),
          );
          const incomplete = [...indices]
            .map((i) => {
              const missing = g.fields
                .filter((f) => !byPath.has(`${g.key}[${i}].${f.key}`))
                .map((f) => f.key);
              return missing.length
                ? { entry: `${g.key}[${i}]`, missingFields: missing }
                : null;
            })
            .filter(Boolean);
          return { group: g.key, entries: indices.size, incomplete };
        });

        return {
          missingSingleFields: missingSingles,
          groups,
          flagged: recorded
            .filter((f) => f.status === "flagged")
            .map((f) => f.path),
        };
      },
    }),
  };
}

async function upsertField(input: {
  documentId: string;
  actor: `agent:${string}`;
  path: string;
  value: string | null;
  confidence: number;
  spans: SourceSpan[] | null;
  status: "extracted" | "flagged";
  critical: boolean;
  note: string | null;
}) {
  const [existing] = await db
    .select()
    .from(fields)
    .where(
      and(eq(fields.documentId, input.documentId), eq(fields.path, input.path)),
    )
    .limit(1);

  // The event is written first: the audit log must record the attempt even if the
  // field write fails afterwards.
  await db.insert(events).values({
    documentId: input.documentId,
    fieldPath: input.path,
    actor: input.actor,
    action: input.status === "flagged" ? "flagged" : "extracted",
    oldValue: existing?.value ?? null,
    newValue: input.value,
    evidence: {
      spans: input.spans ?? undefined,
      confidence: input.confidence,
      reason: input.note ?? undefined,
    },
  });

  const values = {
    documentId: input.documentId,
    path: input.path,
    value: input.value,
    confidence: input.confidence,
    sourceSpans: input.spans,
    status: input.status,
    critical: input.critical,
    note: input.note,
    updatedAt: new Date(),
  };

  await db
    .insert(fields)
    .values(values)
    .onConflictDoUpdate({
      target: [fields.documentId, fields.path],
      set: values,
    });
}
