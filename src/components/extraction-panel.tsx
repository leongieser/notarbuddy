"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentStepPayload, AgentStepType } from "@/db/types";
import {
  DEFAULT_MODEL,
  estimateCostUsd,
  formatUsd,
  priceLabel,
  SELECTABLE_MODELS,
} from "@/lib/agent/pricing";

interface Step {
  id: string;
  seq: number;
  type: AgentStepType;
  payload: AgentStepPayload;
}

interface Run {
  id: string;
  status: "running" | "succeeded" | "failed";
  model: string;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
}

export function ExtractionPanel({
  documentId,
  initialRunId,
}: {
  documentId: string;
  initialRunId: string | null;
}) {
  const router = useRouter();
  const [runId, setRunId] = useState(initialRunId);
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [starting, setStarting] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const refreshedFor = useRef<string | null>(null);

  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/runs/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    setRun(data.run);
    setSteps(data.steps);
    return data.run.status as Run["status"];
  }, []);

  useEffect(() => {
    if (!runId) return;
    let active = true;

    const tick = async () => {
      const status = await poll(runId);
      if (!active) return;
      if (status === "running") {
        setTimeout(tick, 2000);
      } else if (status && refreshedFor.current !== runId) {
        // Fields are rendered by the server component, so a finished run needs a refresh.
        refreshedFor.current = runId;
        router.refresh();
      }
    };
    tick();

    return () => {
      active = false;
    };
  }, [runId, poll, router]);

  async function start() {
    setStarting(true);
    setSteps([]);
    refreshedFor.current = null;
    const res = await fetch(`/api/documents/${documentId}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    setStarting(false);
    setRunId(data.runId);
  }

  const running = run?.status === "running" || starting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3">
        <Select
          value={model}
          onValueChange={(value) => value && setModel(value)}
          disabled={running}
        >
          <SelectTrigger className="w-64" size="sm">
            {/* Base UI renders the raw value by default; show the readable label. */}
            <SelectValue>
              {(value) =>
                SELECTABLE_MODELS.find((m) => m.id === value)?.label ?? value
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SELECTABLE_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label} · {priceLabel(m.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={running}>
            {running
              ? "Agent läuft …"
              : runId
                ? "Erneut extrahieren"
                : "Extraktion starten"}
          </Button>
          {run ? (
            <>
              <Badge
                variant={run.status === "failed" ? "destructive" : "secondary"}
              >
                {run.status}
              </Badge>
              <span className="text-muted-foreground text-xs">{run.model}</span>
              <span className="text-muted-foreground text-xs">
                {steps.length} Schritte
              </span>
              {run.inputTokens ? <Spend run={run} /> : null}
            </>
          ) : null}
        </div>
      </div>

      {run?.error ? (
        <p className="text-destructive text-sm">{run.error}</p>
      ) : null}

      {steps.length > 0 ? (
        <ol className="max-h-[28rem] overflow-auto rounded border">
          {steps.map((step) => (
            <li key={step.id} className="border-b px-3 py-2 last:border-b-0">
              <StepRow step={step} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Spend({ run }: { run: Run }) {
  const usd = estimateCostUsd(run.model, run);
  const cached = run.cachedInputTokens ?? 0;
  const share = run.inputTokens
    ? Math.round((cached / run.inputTokens) * 100)
    : 0;

  return (
    <>
      {usd !== null ? (
        <span className="font-medium text-sm tabular-nums">
          {formatUsd(usd)}
        </span>
      ) : null}
      <span className="text-muted-foreground text-xs tabular-nums">
        {run.inputTokens?.toLocaleString("de-DE")} in /{" "}
        {run.outputTokens?.toLocaleString("de-DE")} out
        {cached > 0 ? ` · ${share}% aus Cache` : ""}
      </span>
    </>
  );
}

function StepRow({ step }: { step: Step }) {
  const { type, payload } = step;

  if (type === "reasoning" || type === "finish") {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {type === "finish" ? "Abschluss" : "Überlegung"}
        </span>
        <p className="whitespace-pre-wrap text-sm">{payload.text}</p>
      </div>
    );
  }

  const summary =
    type === "tool_call" ? summarise(payload.input) : summarise(payload.output);

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground text-xs">{step.seq}</span>
      <span className="font-medium text-xs">
        {type === "tool_call" ? "→" : "←"} {payload.toolName}
      </span>
      <span className="truncate font-mono text-muted-foreground text-xs">
        {summary}
      </span>
    </div>
  );
}

function summarise(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
