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

/** How close to the bottom still counts as watching the tail. */
const TAIL_SLACK = 48;

const RUN_LABEL = {
  running: "läuft",
  succeeded: "erfolgreich",
  failed: "fehlgeschlagen",
} as const;

const RUN_BADGE = {
  running: "secondary",
  succeeded: "success",
  failed: "destructive",
} as const;

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
  // How many field-writing tool results the page has already been refreshed for.
  const seenWrites = useRef(0);
  const stepList = useRef<HTMLOListElement>(null);
  // Follow the tail only while the reader is already at it. Scrolling them back down
  // mid-sentence because a tool call landed is the same mistake as a sticky panel that
  // fights the scroll; reading an earlier step has to survive the next one arriving.
  const following = useRef(true);

  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/runs/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    setRun(data.run);
    setSteps(data.steps);
    return {
      status: data.run.status as Run["status"],
      // Only these two write fields, so counting them is the cheapest honest signal that
      // the dataset changed — refreshing on every poll would re-run the page's queries
      // every two seconds for nothing.
      writes: (data.steps as Step[]).filter(
        (step) =>
          step.type === "tool_result" &&
          (step.payload?.toolName === "record_fields" ||
            step.payload?.toolName === "flag_field"),
      ).length,
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let active = true;

    const tick = async () => {
      const result = await poll(runId);
      if (!active || !result) return;

      // The dataset is rendered by the server component, so it only moves when the page
      // refreshes. Doing that as the agent records lets the Datensatz fill during the run
      // instead of appearing all at once at the end.
      if (result.writes > seenWrites.current) {
        seenWrites.current = result.writes;
        router.refresh();
      }

      if (result.status === "running") {
        setTimeout(tick, 2000);
      } else if (refreshedFor.current !== runId) {
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
    seenWrites.current = 0;
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

  // A finished run opens at its first step — that is where you read from. A live one
  // stays at its last, because the next step is the one you are waiting for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: steps.length is the trigger — a new step is exactly what this reacts to
  useEffect(() => {
    const list = stepList.current;
    if (!list || !running || !following.current) return;
    list.scrollTop = list.scrollHeight;
  }, [steps.length, running]);

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
              <Badge variant={RUN_BADGE[run.status]}>
                {RUN_LABEL[run.status]}
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
        <ol
          ref={stepList}
          onScroll={(event) => {
            const el = event.currentTarget;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < TAIL_SLACK;
          }}
          className="max-h-[28rem] overflow-auto rounded border"
        >
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
