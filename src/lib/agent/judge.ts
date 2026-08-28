import { readFile } from "node:fs/promises";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { agentSteps, db, events, fields, pages, runs } from "@/db";
import { resolvePageImage } from "@/lib/ingest/storage";

const verdictSchema = z.object({
  verdict: z.enum(["bestaetigt", "widersprochen"]),
  begruendung: z.string(),
  beanstandet: z
    .array(z.object({ path: z.string(), problem: z.string() }))
    .default([]),
});

const INSTRUCTIONS = `Du prüfst einen bereits erfassten Eintrag aus einem deutschen Grundbuchauszug gegen die Quelle.

Du bist nicht der Erfasser. Du siehst seine Begründung nicht und sollst sie nicht
rekonstruieren. Deine Aufgabe ist ausschließlich: stimmt das, was hier steht, mit Seitentext
und Seitenbild überein?

Achte besonders auf:
- **status**: Ein unterstrichener oder durchgestrichener Eintrag ist gelöscht, auch wenn der
  Text das nicht sagt. Prüfe das im Bild, Zeile für Zeile. Ein als "aktiv" erfasster, aber
  unterstrichener Eintrag ist der schwerste Fehler.
- **Beträge und Daten**: müssen wortgetreu so dastehen wie im Auszug, samt Tausenderpunkt
  und Dezimalkomma.
- **Verwechslungen zwischen Zeilen**: Werte, die zur Nachbarzeile gehören.

Im Zweifel widersprichst du. Ein unnötiger Widerspruch kostet eine menschliche Prüfung,
ein übersehener Fehler landet in einer Urkunde.`;

interface JudgeEntry {
  key: string;
  pageIndex: number;
  fields: { path: string; value: string | null; quote: string }[];
}

export async function runJudge(documentId: string, model: string) {
  const [run] = await db
    .insert(runs)
    .values({ documentId, kind: "judge", model })
    .returning();

  const critical = await db
    .select()
    .from(fields)
    .where(and(eq(fields.documentId, documentId), eq(fields.critical, true)));

  // Only pre-approvals are worth a second opinion; already-flagged fields are going to a
  // human anyway, and confirmed ones have had one.
  const pending = critical.filter((f) => f.status === "extracted");

  const byEntry = new Map<string, JudgeEntry>();
  for (const field of pending) {
    const key = field.path.replace(/\.[^.]+$/, "");
    const span = field.sourceSpans?.[0];
    if (!span) continue;
    const entry = byEntry.get(key) ?? {
      key,
      pageIndex: span.pageIndex,
      fields: [],
    };
    entry.fields.push({
      path: field.path,
      value: field.value,
      quote: span.quote,
    });
    byEntry.set(key, entry);
  }

  const docPages = await db
    .select()
    .from(pages)
    .where(eq(pages.documentId, documentId));
  const pageByIndex = new Map(docPages.map((p) => [p.pageIndex, p]));

  let seq = 0;
  let escalated = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  try {
    for (const entry of byEntry.values()) {
      const page = pageByIndex.get(entry.pageIndex);
      if (!page?.canonicalText) continue;

      const png = await readFile(resolvePageImage(page.imagePath));
      const listing = entry.fields
        .map(
          (f) =>
            `- ${f.path} = ${JSON.stringify(f.value)}   [belegt mit: „${f.quote}"]`,
        )
        .join("\n");

      const result = await generateObject({
        model: anthropic(model),
        schema: verdictSchema,
        system: INSTRUCTIONS,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Seitentext (Seite ${entry.pageIndex + 1}):\n\n${page.canonicalText}\n\nErfasst wurde für ${entry.key}:\n${listing}\n\nStimmt das?`,
              },
              { type: "image", image: png },
            ],
          },
        ],
      });

      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;

      await db.insert(agentSteps).values({
        runId: run.id,
        seq: seq++,
        type: "tool_result",
        payload: { toolName: `pruefung:${entry.key}`, output: result.object },
      });

      if (result.object.verdict === "widersprochen") {
        escalated++;
        const paths = result.object.beanstandet.length
          ? result.object.beanstandet.map((b) => b.path)
          : entry.fields.map((f) => f.path);

        // Back to the human. The judge never overwrites a value — it only withdraws the
        // agent's pre-approval so the field cannot slip through unreviewed.
        await db
          .update(fields)
          .set({
            status: "flagged",
            note: result.object.begruendung,
            updatedAt: new Date(),
          })
          .where(
            and(eq(fields.documentId, documentId), inArray(fields.path, paths)),
          );

        for (const path of paths) {
          await db.insert(events).values({
            documentId,
            fieldPath: path,
            actor: `judge:${run.id}`,
            action: "judge_escalated",
            evidence: {
              reason:
                result.object.beanstandet.find((b) => b.path === path)
                  ?.problem ?? result.object.begruendung,
              model,
            },
          });
        }
      } else {
        for (const field of entry.fields) {
          await db.insert(events).values({
            documentId,
            fieldPath: field.path,
            actor: `judge:${run.id}`,
            action: "judge_verified",
            evidence: { reason: result.object.begruendung, model },
          });
        }
      }
    }

    await db
      .update(runs)
      .set({ status: "succeeded", finishedAt: new Date(), ...usage })
      .where(eq(runs.id, run.id));

    return { runId: run.id, checked: byEntry.size, escalated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(runs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        ...usage,
      })
      .where(eq(runs.id, run.id));
    throw error;
  }
}
