import { after } from "next/server";
import { z } from "zod";
import { DEFAULT_MODEL, isSelectableModel } from "@/lib/agent/pricing";
import { runExtraction, startExtraction } from "@/lib/agent/run";

export const maxDuration = 800;

const body = z.object({ model: z.string().optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const model = parsed.success
    ? (parsed.data.model ?? DEFAULT_MODEL)
    : DEFAULT_MODEL;

  // The client picks from a list, but the endpoint is the thing that has to enforce it.
  if (!isSelectableModel(model)) {
    return Response.json(
      { error: `Unbekanntes Modell: ${model}` },
      { status: 400 },
    );
  }

  // A full extraction takes minutes. The request returns the run id straight away and
  // the loop continues afterwards; the client follows along by polling the run.
  const run = await startExtraction(id, model);

  after(async () => {
    try {
      await runExtraction(id, run);
    } catch {
      // runExtraction already records the failure on the run and in the audit log.
    }
  });

  return Response.json({ runId: run.id }, { status: 202 });
}
