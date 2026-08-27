import { asc, eq } from "drizzle-orm";
import { agentSteps, db, runs } from "@/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [run] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!run) return new Response("not found", { status: 404 });

  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.runId, id))
    .orderBy(asc(agentSteps.seq));

  return Response.json({ run, steps });
}
