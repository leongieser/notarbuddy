import { anthropic } from "@ai-sdk/anthropic";
import { isStepCount, ToolLoopAgent } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { agentSteps, db, documents, events, fields, runs } from "@/db";
import type { AgentStepPayload, AgentStepType } from "@/db/types";
import { EXTRACTION_INSTRUCTIONS } from "./prompt";
import { buildTools } from "./tools";

/** Safety cap only — the agent normally stops on its own once check_completeness is clean. */
const MAX_STEPS = 40;

/**
 * Creates the run row up front so the client has something to poll immediately, and
 * clears out what the previous run left behind.
 *
 * Only agent-owned fields are cleared. Anything a human confirmed or corrected survives a
 * re-run — their review is not the agent's to discard. The audit log is untouched either
 * way: deleting a current-state row does not erase the events that produced it.
 */
export async function startExtraction(documentId: string, model: string) {
  await db
    .delete(fields)
    .where(
      and(
        eq(fields.documentId, documentId),
        inArray(fields.status, ["extracted", "flagged"]),
      ),
    );

  const [run] = await db
    .insert(runs)
    .values({ documentId, kind: "extraction", model })
    .returning();

  await db
    .update(documents)
    .set({ status: "extracting" })
    .where(eq(documents.id, documentId));

  return run;
}

export async function runExtraction(
  documentId: string,
  run: { id: string; model: string },
) {
  let seq = 0;
  const record = (type: AgentStepType, payload: AgentStepPayload) =>
    db.insert(agentSteps).values({ runId: run.id, seq: seq++, type, payload });

  // Accumulated per step rather than only at the end, so spend is visible while the
  // agent is still running — which is when it matters for a capped budget.
  const spent = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  };

  const agent = new ToolLoopAgent({
    model: anthropic(run.model),
    instructions: EXTRACTION_INSTRUCTIONS,
    tools: buildTools(documentId, run.id),
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0,
    /**
     * The whole history — including page images — is resent on every step. Anthropic
     * caches the prefix up to a breakpoint, so the breakpoint is moved to the end of the
     * history each step: everything already seen is read from cache instead of re-billed.
     */
    prepareStep: ({ messages }) => {
      const last = messages.at(-1);
      if (!last) return {};
      return {
        messages: [
          ...messages.slice(0, -1),
          {
            ...last,
            providerOptions: {
              ...last.providerOptions,
              anthropic: {
                ...last.providerOptions?.anthropic,
                cacheControl: { type: "ephemeral" },
              },
            },
          },
        ],
      };
    },
  });

  try {
    const result = await agent.generate({
      prompt:
        "Lies den Grundbuchauszug und übertrage ihn in den Urkunden-Datensatz. Beginne mit list_pages.",
      onStepEnd: async (step) => {
        spent.inputTokens += step.usage?.inputTokens ?? 0;
        spent.outputTokens += step.usage?.outputTokens ?? 0;
        spent.cachedInputTokens +=
          step.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
        spent.cacheWriteTokens +=
          step.usage?.inputTokenDetails?.cacheWriteTokens ?? 0;
        await db.update(runs).set(spent).where(eq(runs.id, run.id));

        if (step.text?.trim()) await record("reasoning", { text: step.text });
        for (const call of step.toolCalls ?? []) {
          await record("tool_call", {
            toolName: call.toolName,
            input: call.input,
          });
        }
        for (const toolResult of step.toolResults ?? []) {
          // The page image itself would bloat the protocol; record that it was viewed.
          const output =
            toolResult.toolName === "view_page"
              ? { viewed: true }
              : toolResult.output;
          await record("tool_result", {
            toolName: toolResult.toolName,
            output,
          });
        }
      },
    });

    await record("finish", { text: result.text });
    await db
      .update(runs)
      .set({ status: "succeeded", finishedAt: new Date(), ...spent })
      .where(eq(runs.id, run.id));
    await db
      .update(documents)
      .set({ status: "review" })
      .where(eq(documents.id, documentId));

    return { runId: run.id, summary: result.text, steps: seq };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(runs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        ...spent,
      })
      .where(eq(runs.id, run.id));
    await db
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, documentId));
    await db.insert(events).values({
      documentId,
      actor: `agent:${run.id}`,
      action: "run_failed",
      evidence: { reason: message, model: run.model },
    });
    throw error;
  }
}
