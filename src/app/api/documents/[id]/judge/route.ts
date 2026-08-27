import { z } from "zod";
import { runJudge } from "@/lib/agent/judge";
import { isSelectableModel } from "@/lib/agent/pricing";

export const maxDuration = 300;

const body = z.object({ model: z.string() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isSelectableModel(parsed.data.model)) {
    return Response.json({ error: "Unbekanntes Modell." }, { status: 400 });
  }

  try {
    return Response.json(await runJudge(id, parsed.data.model));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
